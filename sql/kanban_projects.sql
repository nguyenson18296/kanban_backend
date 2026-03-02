-- ============================================
-- KANBAN PROJECT — PROJECT ENTITY
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================
-- Depends on:
--   kanban_users.sql   (users table, fn_update_timestamp, pgcrypto)
--   kanban_teams.sql   (teams table)
--   kanban_tasks.sql   (kanban_columns table)


-- ============================================
-- 1. ID GENERATION FUNCTION
-- ============================================
-- Generates a random 8-character alphanumeric string (A-Z, a-z, 0-9)
-- Mirrors the Node.js generateAlphanumericId() in project.entity.ts

CREATE OR REPLACE FUNCTION fn_generate_project_id()
RETURNS TEXT AS $$
DECLARE
    chars  TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    result TEXT := '';
    i      INT;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::INT, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- 2. PROJECTS TABLE
-- ============================================

CREATE TABLE projects (
    id              VARCHAR(8) PRIMARY KEY DEFAULT fn_generate_project_id(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    team_id         INT REFERENCES teams(id) ON DELETE SET NULL,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_projects_name UNIQUE (name),
    CONSTRAINT chk_projects_id CHECK (id ~ '^[A-Za-z0-9]+$')
);


-- ============================================
-- 3. INDEXES
-- ============================================

CREATE INDEX idx_projects_team_id ON projects (team_id);
CREATE INDEX idx_projects_created_by ON projects (created_by);


-- ============================================
-- 4. AUTO-UPDATE updated_at TRIGGER
-- ============================================
-- Reuses fn_update_timestamp() from users migration

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- ============================================
-- 5. MIGRATE KANBAN_COLUMNS: add project_id FK
-- ============================================
-- project_id is required — every column must belong to a project.
-- ON DELETE RESTRICT prevents deleting a project that still has columns.

ALTER TABLE kanban_columns ADD COLUMN project_id VARCHAR(8);

-- Backfill: assign all existing columns to a default project
-- INSERT INTO projects (name, description)
-- VALUES ('Default Project', 'Default kanban board project');
-- UPDATE kanban_columns SET project_id = (SELECT id FROM projects WHERE name = 'Default Project');

ALTER TABLE kanban_columns ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE kanban_columns
    ADD CONSTRAINT fk_kanban_columns_project
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE RESTRICT;

CREATE INDEX idx_kanban_columns_project_id ON kanban_columns (project_id);


-- ============================================
-- 6. EXAMPLE QUERIES
-- ============================================

-- -------------------------------------------------
-- 6a. CREATE a project
--     POST /api/projects
-- -------------------------------------------------
-- INSERT INTO projects (name, description, team_id, created_by)
-- VALUES (
--     'My Kanban Board',
--     'A project for tracking tasks',
--     (SELECT id FROM teams WHERE name = 'Platform'),
--     (SELECT id FROM users WHERE email = 'alice@kanban.dev')
-- );


-- -------------------------------------------------
-- 6b. LIST all projects
--     GET /api/projects
-- -------------------------------------------------
-- SELECT id, name, description, team_id, created_by, created_at, updated_at
-- FROM projects
-- ORDER BY created_at DESC;


-- -------------------------------------------------
-- 6c. GET a project by ID
--     GET /api/projects/:id
-- -------------------------------------------------
-- SELECT id, name, description, team_id, created_by, created_at, updated_at
-- FROM projects
-- WHERE id = 'aB3kM9xZ';


-- -------------------------------------------------
-- 6d. UPDATE a project
--     PATCH /api/projects/:id
-- -------------------------------------------------
-- UPDATE projects
-- SET name = 'Renamed Board',
--     description = 'Updated description'
-- WHERE id = 'aB3kM9xZ';


-- -------------------------------------------------
-- 6e. DELETE a project
--     DELETE /api/projects/:id
--     Fails with FK violation if columns still reference this project.
-- -------------------------------------------------
-- DELETE FROM projects WHERE id = 'aB3kM9xZ';


-- -------------------------------------------------
-- 6f. CREATE a column in a project
--     POST /api/columns  (body includes project_id)
-- -------------------------------------------------
-- INSERT INTO kanban_columns (name, position, color, project_id)
-- VALUES ('QA Testing', 5, '#F43F5E', 'aB3kM9xZ');


-- -------------------------------------------------
-- 6g. GET /api/board/:projectId — Board scoped to a project
--     Returns columns and tasks belonging to the given project.
--     Supports same filters as the global board (priority, search, assignee, label).
-- -------------------------------------------------

-- Step 1: Verify project exists (app returns 404 if not found)
-- SELECT id FROM projects WHERE id = 'aB3kM9xZ';

-- Step 2: Fetch board scoped to project
-- SELECT json_build_object('columns',
--     (SELECT COALESCE(json_agg(col_data ORDER BY col_data.position), '[]'::json)
--      FROM (
--          SELECT
--              kc.id,
--              kc.name,
--              kc.position,
--              kc.color,
--              (SELECT COUNT(*)
--               FROM tasks t
--               WHERE t.column_id = kc.id) AS task_count,
--              (SELECT COALESCE(json_agg(task_row ORDER BY task_row.position), '[]'::json)
--               FROM (
--                   SELECT
--                       t.id, t.title, t.ticket_id, t.position,
--                       t.status, t.priority, t.created_at,
--                       (SELECT COALESCE(json_agg(json_build_object(
--                           'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url
--                       )), '[]'::json)
--                       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
--                       WHERE ta.task_id = t.id) AS assignees,
--                       (SELECT COALESCE(json_agg(json_build_object(
--                           'id', l.id, 'name', l.name, 'color', l.color
--                       )), '[]'::json)
--                       FROM task_labels tl JOIN labels l ON l.id = tl.label_id
--                       WHERE tl.task_id = t.id) AS labels
--                   FROM tasks t
--                   WHERE t.column_id = kc.id
--                   ORDER BY t.position
--                   LIMIT 50                                  -- tasksPerColumn
--               ) task_row
--              ) AS tasks
--          FROM kanban_columns kc
--          WHERE kc.is_archived = FALSE
--            AND kc.project_id = 'aB3kM9xZ'                  -- scoped to project
--          ORDER BY kc.position
--      ) col_data
--     )
-- );


-- -------------------------------------------------
-- 6h. Board with combined filters scoped to project
--     GET /api/board/aB3kM9xZ?priority=high&assigneeId=<uuid>&tasksPerColumn=10
-- -------------------------------------------------
-- Same as 6g but add to inner tasks WHERE clause:
--   AND t.priority = 'high'
--   AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = '<assignee-uuid>')
-- And adjust LIMIT to tasksPerColumn value.
-- The task_count subquery gets the same filters.
