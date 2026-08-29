-- ============================================
-- KANBAN PROJECT — PROJECT MEMBERSHIP & RBAC
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================
-- Depends on:
--   kanban_users.sql     (users table, pgcrypto)
--   kanban_projects.sql  (projects table)
--   kanban_tasks.sql     (tasks, kanban_columns tables)
--   team_members table   (project-scoped teams; see src/modules/team/team-member.entity.ts
--                         — not yet documented in sql/)
--
-- Mirrors: ProjectMember entity + ProjectAccessService (the single
-- authorization gate), src/modules/project/


-- ============================================
-- 1. ROLE ENUM
-- ============================================
-- Declaration order mirrors the TS enum (owner first). Note: PostgreSQL
-- enums compare by DECLARATION order, so here 'owner' < 'viewer' — the
-- native comparison is the OPPOSITE of privilege. Never rank roles with
-- <  /  > on this type; use fn_project_role_rank() below instead.

CREATE TYPE project_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Historical note (KAN-86): 'viewer' was added to an existing enum with
--   ALTER TYPE project_role ADD VALUE 'viewer';
-- (appends to the end — another reason declaration order ≠ privilege order)


-- ============================================
-- 2. PROJECT_MEMBERS TABLE
-- ============================================
-- Composite PK: one membership row per (project, user).
-- CASCADE both ways: deleting a project or a user erases its memberships.

CREATE TABLE project_members (
    project_id  VARCHAR(8) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID       NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    role        project_role NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (project_id, user_id)
);


-- ============================================
-- 3. INDEXES
-- ============================================
-- The PK already serves (project_id, user_id) lookups — the gate's hot path.
-- This extra index serves user-first queries (getProjectIdsForUser).

CREATE INDEX idx_project_members_user_id ON project_members (user_id);


-- ============================================
-- 4. ROLE HIERARCHY
-- ============================================
-- Mirrors PROJECT_ROLE_HIERARCHY in project-member.entity.ts:
--   owner=3 > admin=2 > member=1 > viewer=0

CREATE OR REPLACE FUNCTION fn_project_role_rank(r project_role)
RETURNS INT AS $$
    SELECT CASE r
        WHEN 'owner'  THEN 3
        WHEN 'admin'  THEN 2
        WHEN 'member' THEN 1
        WHEN 'viewer' THEN 0
    END;
$$ LANGUAGE sql IMMUTABLE;


-- ============================================
-- 5. THE AUTHORIZATION GATE (ProjectAccessService)
-- ============================================
-- Convention (anti-enumeration): a caller with NO membership gets a 404
-- indistinguishable from a nonexistent resource — never a 403 that would
-- confirm the resource exists. A member BELOW the required role gets 403.

-- -------------------------------------------------
-- 5a. getMembership(projectId, userId)
-- -------------------------------------------------
-- SELECT project_id, user_id, role, joined_at
-- FROM project_members
-- WHERE project_id = 'aB3kM9xZ'
--   AND user_id = '<actor-uuid>';

-- -------------------------------------------------
-- 5b. ensureRole(projectId, userId, minimumRole)
--     e.g. minimumRole = 'admin'
-- -------------------------------------------------
-- SELECT
--     pm.role,
--     fn_project_role_rank(pm.role) >= fn_project_role_rank('admin') AS allowed
-- FROM project_members pm
-- WHERE pm.project_id = 'aB3kM9xZ'
--   AND pm.user_id = '<actor-uuid>';
--
-- 0 rows          -> 404 'Project with id "aB3kM9xZ" not found'  (masked)
-- allowed = false -> 403 'This action requires at least admin role'
-- allowed = true  -> proceed

-- -------------------------------------------------
-- 5c. getProjectIdsForUser(userId)
--     (uses idx_project_members_user_id)
-- -------------------------------------------------
-- SELECT project_id
-- FROM project_members
-- WHERE user_id = '<actor-uuid>';

-- -------------------------------------------------
-- 5d. getProjectIdForTask(taskId)
--     Tasks carry no project_id — resolve it through the column.
-- -------------------------------------------------
-- SELECT col.project_id
-- FROM tasks task
-- INNER JOIN kanban_columns col ON col.id = task.column_id
-- WHERE task.id = '<task-uuid>';

-- -------------------------------------------------
-- 5e. getProjectIdForColumn(columnId)
-- -------------------------------------------------
-- SELECT col.project_id
-- FROM kanban_columns col
-- WHERE col.id = 7;

-- -------------------------------------------------
-- 5f. ensureTaskRole(taskId, userId, minimumRole) — one-query version
--     The app runs 5d then 5b; a LEFT JOIN does both in one round trip
--     while still distinguishing the two failure modes.
-- -------------------------------------------------
-- SELECT
--     col.project_id,
--     pm.role,
--     fn_project_role_rank(pm.role) >= fn_project_role_rank('member') AS allowed
-- FROM tasks task
-- INNER JOIN kanban_columns col ON col.id = task.column_id
-- LEFT JOIN project_members pm
--        ON pm.project_id = col.project_id
--       AND pm.user_id = '<actor-uuid>'
-- WHERE task.id = '<task-uuid>';
--
-- 0 rows          -> 404 'Task ... not found'  (task really missing)
-- pm.role IS NULL -> 404 'Task ... not found'  (non-member: SAME message,
--                    so the 404 text never becomes an existence oracle)
-- allowed = false -> 403


-- ============================================
-- 6. EXAMPLE QUERIES — ENDPOINT FLOWS
-- ============================================

-- -------------------------------------------------
-- 6a. CREATE a project + auto-add creator as owner
--     POST /api/projects  (ProjectService.create — one transaction)
-- -------------------------------------------------
-- BEGIN;
-- INSERT INTO projects (name, description, tag, created_by)
-- VALUES ('My Kanban Board', 'Tracking tasks', 'MKB',
--         (SELECT id FROM users WHERE email = 'alice@kanban.dev'));
--
-- INSERT INTO project_members (project_id, user_id, role)
-- VALUES ('<returned-project-id>',
--         (SELECT id FROM users WHERE email = 'alice@kanban.dev'),
--         'owner');
-- COMMIT;
--
-- SQL-native alternative — atomic without an explicit transaction,
-- using a data-modifying CTE:
-- WITH new_project AS (
--     INSERT INTO projects (name, description, tag, created_by)
--     VALUES ('My Kanban Board', 'Tracking tasks', 'MKB', '<actor-uuid>')
--     RETURNING id
-- )
-- INSERT INTO project_members (project_id, user_id, role)
-- SELECT id, '<actor-uuid>', 'owner' FROM new_project;

-- -------------------------------------------------
-- 6b. ADD members (requires admin+)
--     POST /api/projects/:id/members  (ProjectService.addMembers)
-- -------------------------------------------------
-- Step 1: project exists?            SELECT EXISTS (SELECT 1 FROM projects WHERE id = 'aB3kM9xZ');
-- Step 2: gate (5b, minimum 'admin') -- 404 if non-member, 403 if below admin
-- Step 3: all target users exist?
-- SELECT id FROM users WHERE id IN ('<uuid-1>', '<uuid-2>');
--   (app 404s listing the missing ids if the count doesn't match)
-- Step 4: insert only NEW memberships (default role 'member').
--   The app SELECTs existing rows and filters in JS; in raw SQL the
--   composite PK lets ON CONFLICT do it atomically:
-- INSERT INTO project_members (project_id, user_id)
-- VALUES ('aB3kM9xZ', '<uuid-1>'), ('aB3kM9xZ', '<uuid-2>')
-- ON CONFLICT (project_id, user_id) DO NOTHING;

-- -------------------------------------------------
-- 6c. REMOVE members (requires admin+)
--     DELETE /api/projects/:id/members  (ProjectService.removeMembers)
-- -------------------------------------------------
-- Step 1: project exists?  Step 2: gate (5b).
-- Step 3: leaving the project also means leaving your team in it —
--         team_members rows go first:
-- DELETE FROM team_members
-- WHERE project_id = 'aB3kM9xZ'
--   AND user_id IN ('<uuid-1>', '<uuid-2>');
--
-- Step 4:
-- DELETE FROM project_members
-- WHERE project_id = 'aB3kM9xZ'
--   AND user_id IN ('<uuid-1>', '<uuid-2>');
--
-- The app currently issues these as two separate statements; run by hand,
-- wrap both DELETEs in one BEGIN/COMMIT so a failure can't strand a user
-- with a team but no project membership.

-- -------------------------------------------------
-- 6d. TEAM mutations — gate BEFORE the team lookup
--     POST /api/projects/:projectId/teams/:teamId/members
--     (TeamService.addMember; same ordering in create/removeMember)
-- -------------------------------------------------
-- Step 1: gate FIRST (5b, minimum 'admin'). Running the team lookup first
--         would leak team existence to non-members: "team 404" vs
--         "project 404" is an oracle. Gate-first, a non-member always sees
--         the same masked project 404.
-- Step 2: team exists in THIS project?
-- SELECT id, name FROM teams
-- WHERE id = 7 AND project_id = 'aB3kM9xZ';
--
-- Step 3: target user must already be a project member (else 400):
-- SELECT EXISTS (
--     SELECT 1 FROM project_members
--     WHERE project_id = 'aB3kM9xZ' AND user_id = '<target-uuid>'
-- );
--
-- Step 4: insert (uq(user_id, project_id) on team_members enforces
--         "one team per project per user" — a duplicate raises 23505 -> 409):
-- INSERT INTO team_members (team_id, user_id, project_id)
-- VALUES (7, '<target-uuid>', 'aB3kM9xZ');

-- -------------------------------------------------
-- 6e. LIST project members with user info
--     GET /api/projects/:id/members  (ProjectService.getMembers)
-- -------------------------------------------------
-- SELECT pm.project_id, pm.user_id, pm.role, pm.joined_at,
--        u.full_name, u.email, u.avatar_url
-- FROM project_members pm
-- INNER JOIN users u ON u.id = pm.user_id
-- WHERE pm.project_id = 'aB3kM9xZ'
-- ORDER BY pm.joined_at ASC;
