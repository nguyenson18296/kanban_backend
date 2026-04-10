# Project-Scoped Teams & Membership — Technical Documentation

**Feature:** Project-Scoped Teams, Project Membership, and Role-Based Access Control
**Modules:** `ProjectModule`, `TeamModule`
**Author:** Backend Engineering
**Date:** 2026-04-10
**Stack:** NestJS 11 / TypeORM / PostgreSQL

---

## 1. Overview

### Purpose

A restructured team and membership system where teams are scoped to individual projects, users must be explicitly added to projects before they can participate, and role-based access control governs who can manage members and teams.

### Problem It Solves

- **Global teams didn't fit project workflows:** Previously, teams were global entities and a user belonged to exactly one team across the entire system. This made it impossible to have different team structures per project
- **No project membership concept:** There was no way to track which users belonged to which project, making access control and collaboration boundaries impossible to enforce
- **No ownership or role model:** Anyone could modify any project's configuration. There was no concept of project owner or admin to restrict management operations
- **One team per user limitation:** A user could only be on one team globally, but needed to be on different teams in different projects (e.g., "Backend" in Project A, "QA" in Project B)

### What Changed

| Before | After |
|--------|-------|
| `users.team_id` — one global team per user | Removed. Team membership is per-project via `team_members` |
| `projects.team_id` — one team per project | Removed. Projects have many teams via `teams.project_id` |
| `teams` — global, unique name | Project-scoped. Same name allowed across projects, unique within a project |
| No project membership | `project_members` — explicit user-project assignment with roles |
| No access control | Role-based: `owner`, `admin`, `member` |

---

## 2. Architecture

### High-Level System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                          ProjectModule                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ProjectController                                        │    │
│  │  POST   /projects              (JWT, creates owner)      │    │
│  │  GET    /projects              (public)                   │    │
│  │  GET    /projects/:id          (public)                   │    │
│  │  PATCH  /projects/:id          (public)                   │    │
│  │  DELETE /projects/:id          (public)                   │    │
│  │  GET    /projects/:id/members  (public)                   │    │
│  │  POST   /projects/:id/members  (JWT, admin+)             │    │
│  │  DELETE /projects/:id/members  (JWT, admin+)             │    │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌───────────────────────────▼──────────────────────────────┐    │
│  │  ProjectService                                           │    │
│  │  create() — transactional: project + owner membership     │    │
│  │  getMembers() / addMembers() / removeMembers()           │    │
│  │  ensureProjectRole() — reusable role check                │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│                           TeamModule                              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  TeamController                                           │    │
│  │  POST   /projects/:pid/teams                (JWT, admin+)│    │
│  │  GET    /projects/:pid/teams                (public)      │    │
│  │  GET    /projects/:pid/teams/:tid           (public)      │    │
│  │  GET    /projects/:pid/teams/:tid/members   (public)      │    │
│  │  POST   /projects/:pid/teams/:tid/members   (JWT, admin+)│    │
│  │  DELETE /projects/:pid/teams/:tid/members/:uid (JWT, admin+)│ │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                    │
│  ┌───────────────────────────▼──────────────────────────────┐    │
│  │  TeamService                                              │    │
│  │  create() / findAllByProject() / findOneById()           │    │
│  │  getMembers() / addMember() / removeMember()             │    │
│  │  ensureProjectRole() — checks project_members role        │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ project_members  │  │     teams       │  │  team_members   │  │
│  │ (role-based)     │  │ (project-scoped)│  │ (1 team/user/   │  │
│  │                  │  │                 │  │  project)        │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Module Interaction

```
AppModule
├── ProjectModule
│   ├── entities: [Project, ProjectMember, User]
│   ├── controllers: [ProjectController]
│   ├── providers: [ProjectService]
│   └── exports: [ProjectService]
└── TeamModule
    ├── entities: [Team, TeamMember, Project, ProjectMember]
    ├── controllers: [TeamController]
    ├── providers: [TeamService]
    └── exports: [TeamService]
```

`TeamModule` depends on `ProjectMember` to verify project membership and role before allowing team operations. Both modules are independent at the NestJS module level (no module imports between them) — they share entities through TypeORM.

### Role Hierarchy

```
owner (3) > admin (2) > member (1)
```

| Role | Create teams | Manage members | Manage team members | View | Delete project |
|------|-------------|---------------|--------------------| -----|---------------|
| `owner` | Yes | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | Yes | No |
| `member` | No | No | No | Yes | No |

---

## 3. API Design

### Endpoints Summary

#### Project Members

| Method   | Endpoint                      | Auth     | Role     | Description                   |
|----------|-------------------------------|----------|----------|-------------------------------|
| `GET`    | `/projects/:id/members`       | —        | —        | List project members          |
| `POST`   | `/projects/:id/members`       | JWT      | admin+   | Add members to project        |
| `DELETE` | `/projects/:id/members`       | JWT      | admin+   | Remove members from project   |

#### Project Teams

| Method   | Endpoint                                          | Auth | Role   | Description              |
|----------|---------------------------------------------------|------|--------|--------------------------|
| `POST`   | `/projects/:pid/teams`                            | JWT  | admin+ | Create team in project   |
| `GET`    | `/projects/:pid/teams`                            | —    | —      | List teams in project    |
| `GET`    | `/projects/:pid/teams/:tid`                       | —    | —      | Get team by ID           |
| `GET`    | `/projects/:pid/teams/:tid/members`               | —    | —      | List team members        |
| `POST`   | `/projects/:pid/teams/:tid/members`               | JWT  | admin+ | Add member to team       |
| `DELETE` | `/projects/:pid/teams/:tid/members/:uid`          | JWT  | admin+ | Remove member from team  |

---

### 3.1 List Project Members

**`GET /projects/:id/members`**

Response `200 OK`:
```json
{
  "data": [
    {
      "project_id": "UrzWUH3e",
      "user_id": "49566b0c-1107-42ae-935e-c5af04f6c450",
      "role": "owner",
      "user": {
        "id": "49566b0c-1107-42ae-935e-c5af04f6c450",
        "email": "grace@kanban.dev",
        "full_name": "Grace Bui",
        "role": "tech_lead",
        "avatar_url": "https://api.dicebear.com/9.x/initials/svg?seed=GB",
        "is_active": true,
        "created_at": "2026-02-22T04:25:38.951Z",
        "updated_at": "2026-02-22T04:25:38.951Z"
      },
      "joined_at": "2026-04-10T10:00:00.000Z"
    }
  ],
  "status": 200,
  "success": true
}
```

### 3.2 Add Project Members

**`POST /projects/:id/members`**

Request Body:
```json
{
  "user_ids": [
    "deee8651-9aa9-4496-a308-2a5983e7fa31",
    "05786857-2530-46a4-a723-83bad80887a3"
  ]
}
```

Response: `201 Created` (no body).

Error Responses:

| Status | Condition |
|--------|-----------|
| `403` | Actor is not a project member, or has `member` role (needs `admin`+) |
| `404` | Project not found, or one or more user UUIDs not found |

### 3.3 Remove Project Members

**`DELETE /projects/:id/members`**

Request Body:
```json
{
  "user_ids": ["deee8651-9aa9-4496-a308-2a5983e7fa31"]
}
```

Response: `204 No Content` (no body).

> Removing a user from a project also removes them from any team within that project (cascading cleanup).

### 3.4 Create Team in Project

**`POST /projects/:projectId/teams`**

Request Body:
```json
{
  "name": "Backend Team",
  "description": "Handles server-side development",
  "color": "#3B82F6"
}
```

Response `201 Created`:
```json
{
  "id": 5,
  "name": "Backend Team",
  "description": "Handles server-side development",
  "color": "#3B82F6",
  "is_active": true,
  "project_id": "UrzWUH3e",
  "created_at": "2026-04-10T10:30:00.000Z",
  "updated_at": "2026-04-10T10:30:00.000Z"
}
```

Error Responses:

| Status | Condition |
|--------|-----------|
| `403` | Insufficient role (needs `admin`+) |
| `404` | Project not found |
| `409` | Team name already exists in this project |

### 3.5 List Teams in Project

**`GET /projects/:projectId/teams`**

Response `200 OK`: Array of team objects.

### 3.6 Add Team Member

**`POST /projects/:projectId/teams/:teamId/members`**

Request Body:
```json
{
  "user_id": "deee8651-9aa9-4496-a308-2a5983e7fa31"
}
```

Response: `201 Created` (no body).

Error Responses:

| Status | Condition |
|--------|-----------|
| `400` | User is not a member of the project |
| `403` | Insufficient role (needs `admin`+) |
| `404` | Team not found in project |
| `409` | User is already assigned to a team in this project |

### 3.7 Remove Team Member

**`DELETE /projects/:projectId/teams/:teamId/members/:userId`**

Response: `204 No Content` (no body).

---

## 4. Database Design

### Table: `project_members`

| Column       | Type           | Nullable | Default    | Description                          |
|-------------|----------------|----------|------------|--------------------------------------|
| `project_id`| `VARCHAR(8)`   | NO       | —          | PK, FK to `projects(id)` CASCADE     |
| `user_id`   | `UUID`         | NO       | —          | PK, FK to `users(id)` CASCADE        |
| `role`      | `project_role` | NO       | `'member'` | ENUM: owner, admin, member           |
| `joined_at` | `TIMESTAMPTZ`  | NO       | `now()`    | When the user joined the project     |

### Table: `teams` (modified)

| Column       | Type          | Nullable | Default | Description                              |
|-------------|---------------|----------|---------|------------------------------------------|
| `id`        | `SERIAL`      | NO       | auto    | Primary key                              |
| `name`      | `VARCHAR(100)`| NO       | —       | Team name (unique per project)           |
| `description`| `TEXT`       | YES      | —       | Team description                         |
| `color`     | `VARCHAR(20)` | YES      | —       | Display color                            |
| `is_active` | `BOOLEAN`     | NO       | `true`  | Active status                            |
| `project_id`| `VARCHAR(8)`  | NO       | —       | **NEW** FK to `projects(id)` CASCADE     |
| `created_at`| `TIMESTAMPTZ` | NO       | `now()` | Creation timestamp                       |
| `updated_at`| `TIMESTAMPTZ` | NO       | `now()` | Last update timestamp                    |

### Table: `team_members`

| Column       | Type          | Nullable | Default  | Description                              |
|-------------|---------------|----------|----------|------------------------------------------|
| `team_id`   | `INT`         | NO       | —        | PK, FK to `teams(id)` CASCADE            |
| `user_id`   | `UUID`        | NO       | —        | PK, FK to `users(id)` CASCADE            |
| `project_id`| `VARCHAR(8)`  | NO       | —        | FK to `projects(id)` CASCADE (denormalized) |
| `joined_at` | `TIMESTAMPTZ` | NO       | `now()`  | When the user joined the team            |

### Entity Relationship Diagram

```
┌──────────────┐       ┌────────────────────┐       ┌──────────────┐
│   projects   │       │  project_members   │       │    users     │
├──────────────┤       ├────────────────────┤       ├──────────────┤
│ id (PK)      │◄──────│ project_id (PK,FK) │       │ id (PK)      │
│ name         │       │ user_id (PK,FK)    │──────►│ full_name    │
│ tag          │       │ role               │       │ email        │
│ created_by   │       │ joined_at          │       │ ...          │
│ ...          │       └────────────────────┘       └──────────────┘
└──────────────┘                                           ▲
       ▲                                                   │
       │            ┌────────────────────┐                 │
       │            │      teams         │                 │
       │            ├────────────────────┤                 │
       └────────────│ project_id (FK)    │                 │
                    │ id (PK)            │                 │
                    │ name               │                 │
                    │ ...                │                 │
                    └────────────────────┘                 │
                           ▲                               │
                           │                               │
                    ┌──────┴─────────────┐                 │
                    │   team_members     │                 │
                    ├────────────────────┤                 │
                    │ team_id (PK,FK)    │                 │
                    │ user_id (PK,FK)    │─────────────────┘
                    │ project_id (FK)    │
                    │ joined_at          │
                    │ UNIQUE(user_id,    │
                    │        project_id) │
                    └────────────────────┘
```

### Indexes

| Index Name                        | Table             | Column(s)            | Purpose                              |
|-----------------------------------|-------------------|----------------------|--------------------------------------|
| `PK (project_id, user_id)`       | `project_members` | composite PK         | Primary lookup                       |
| `idx_project_members_user_id`    | `project_members` | `user_id`            | "Which projects is user X in?"       |
| `idx_teams_project_id`           | `teams`           | `project_id`         | "Which teams does project X have?"   |
| `idx_teams_is_active`            | `teams`           | `is_active`          | Filter active teams                  |
| `uq_teams_project_name`          | `teams`           | `(project_id, name)` | Unique team name per project         |
| `PK (team_id, user_id)`          | `team_members`    | composite PK         | Primary lookup                       |
| `idx_team_members_user_id`       | `team_members`    | `user_id`            | "Which team is user X on?"           |
| `idx_team_members_project_id`    | `team_members`    | `project_id`         | "All team assignments in project X"  |
| `UNIQUE (user_id, project_id)`   | `team_members`    | composite            | One team per user per project        |

### Constraints

- All FKs use `ON DELETE CASCADE` — deleting a project removes all its members, teams, and team members
- `project_role` is a PostgreSQL `ENUM` type: `'owner'`, `'admin'`, `'member'`
- `teams.name` is unique per project (composite unique on `project_id` + `name`)
- A user can only be on one team per project (unique on `user_id` + `project_id` in `team_members`)
- `team_members.project_id` is denormalized from `teams.project_id` to enable the unique constraint

---

## 5. Service Logic

### Project Creation Flow

```
1. Client sends POST /projects with JWT
2. ProjectService.create() starts a DB transaction:
   a. Generates unique tag from project name
   b. Creates project record with created_by = actorId
   c. Creates project_members row with role = 'owner' for the creator
   d. Both succeed or both roll back (atomic)
3. Returns the created project with relations
```

### Adding Project Members Flow

```
1. Client sends POST /projects/:id/members with JWT
2. ProjectService.addMembers():
   a. Verify project exists
   b. Verify actor has admin+ role (ensureProjectRole)
   c. Validate all user_ids exist in users table
   d. Filter out users who are already members (idempotent)
   e. Insert new project_members rows with role = 'member'
   f. Return updated member list
```

### Adding Team Members Flow

```
1. Client sends POST /projects/:pid/teams/:tid/members with JWT
2. TeamService.addMember():
   a. Verify team exists in project
   b. Verify actor has admin+ role
   c. Verify target user is a project member (400 if not)
   d. Check if user is already in this team (idempotent if so)
   e. Insert team_members row (DB rejects if user already in another team in this project via UNIQUE constraint)
   f. Return updated team member list
```

### Removing Project Members — Cascading Cleanup

```
1. Client sends DELETE /projects/:id/members with JWT
2. ProjectService.removeMembers():
   a. Verify project exists + actor has admin+ role
   b. Delete from team_members WHERE project_id AND user_id IN (...)
   c. Delete from project_members WHERE project_id AND user_id IN (...)
   d. Return updated member list
```

This ensures a user removed from a project is also removed from their team — no orphaned team memberships.

### Validation Rules

| Rule | Implementation |
|------|---------------|
| Project ID must be 8 alphanumeric chars | `ParseProjectIdPipe` validates format |
| Team ID must be integer | `ParseIntPipe` validates format |
| User IDs must be valid UUID v4 | `@IsUUID('4')` on DTO fields |
| `user_ids` array must be non-empty | `@ArrayNotEmpty()` on `ManageProjectMembersDto` |
| Team name max 100 chars | `@MaxLength(100)` on `CreateTeamDto` |
| User must be project member before joining team | Checked in `TeamService.addMember()` |
| One team per user per project | DB `UNIQUE(user_id, project_id)` on `team_members` |
| Team name unique within project | DB `UNIQUE(project_id, name)` on `teams` |
| `created_by` cannot be spoofed | Removed from DTO; always set from JWT `actorId` |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Add user who is already a project member | Silently skips (idempotent) |
| Add user to team who is already on that team | Returns current members (idempotent) |
| Add user to team who is on another team in same project | `409 Conflict` (DB unique constraint) |
| Add user to team who is not a project member | `400 Bad Request` |
| Remove user from project who is on a team | Team membership removed first, then project membership |
| Create team with duplicate name in same project | `409 Conflict` |
| Create team with same name in different project | Allowed |
| Delete project | All project_members, teams, and team_members cascade-deleted |
| Member tries to add members | `403 Forbidden` (needs admin+) |
| Project created before role system existed | Must manually add owner row to project_members |

---

## 6. Security Considerations

### Authentication & Authorization

| Operation | Auth | Role Check |
|-----------|------|------------|
| Create project | JWT | None (creator becomes owner) |
| List/get projects | None | None |
| Update/delete project | None | None (to be restricted in future) |
| List project members | None | None |
| Add project members | JWT | `admin`+ |
| Remove project members | JWT | `admin`+ |
| Create team | JWT | `admin`+ |
| List/get teams | None | None |
| List team members | None | None |
| Add team member | JWT | `admin`+ |
| Remove team member | JWT | `admin`+ |

### Role Enforcement

Role checks use `ensureProjectRole(projectId, userId, minimumRole)` which:
1. Looks up the user's `project_members` row
2. If not found → `403 You are not a member of this project`
3. Compares role against a numeric hierarchy (`owner=3, admin=2, member=1`)
4. If insufficient → `403 This action requires at least {role} role`

### Input Validation

- All DTOs use `class-validator` decorators with `whitelist: true` and `forbidNonWhitelisted: true`
- `created_by` is not in the DTO — always derived from JWT to prevent spoofing
- `project_id` on `team_members` is set server-side from the URL param, not from client input

---

## 7. Performance Considerations

### Query Optimization

- **Project existence checks** use `existsBy()` — lightweight `SELECT 1 ... LIMIT 1`
- **Role checks** use `findOneBy()` on `project_members` with composite PK — single index scan
- **Team lookups** filter by both `project_id` and `team_id` — indexed
- **Member deduplication** (addMembers) fetches existing members in a single `IN(...)` query before inserting

### Index Strategy

| Query Pattern | Index Used |
|--------------|-----------|
| "Is user X a member of project Y?" | `PK(project_id, user_id)` |
| "All members of project Y" | `PK(project_id, user_id)` — prefix scan |
| "All projects user X belongs to" | `idx_project_members_user_id` |
| "All teams in project Y" | `idx_teams_project_id` |
| "All members of team Z" | `PK(team_id, user_id)` — prefix scan |
| "Is user X already on a team in project Y?" | `UNIQUE(user_id, project_id)` |

### Transaction Safety

Project creation uses `dataSource.transaction()` to atomically create the project and owner membership. If either fails, both roll back — no orphaned projects without owners.

---

## 8. Future Improvements

### Near-Term

| Enhancement | Description |
|-------------|-------------|
| **Viewer role** | Add `viewer` to `ProjectRole` for read-only access to project data |
| **Ownership transfer** | Endpoint to transfer owner role to another admin |
| **Update project requires auth** | Restrict `PATCH /projects/:id` to admin+ |
| **Delete project requires owner** | Restrict `DELETE /projects/:id` to owner only |
| **Team update/delete endpoints** | `PATCH/DELETE /projects/:pid/teams/:tid` for renaming/removing teams |
| **Bulk team member management** | Accept array of user_ids instead of single user_id |

### Long-Term Scalability

| Concern | Strategy |
|---------|----------|
| **Custom roles** | Replace enum with a `project_roles` table for configurable permissions |
| **Permission system** | Fine-grained permissions (e.g., `can_manage_tasks`, `can_view_analytics`) attached to roles |
| **Invitation system** | Invite users by email with pending/accepted state |
| **Audit trail** | Log all membership changes in the activity system |
| **Multi-team membership** | Remove the one-team-per-project constraint if workflows require it |

---

## 9. File Structure

```
src/
├── common/
│   └── interfaces/
│       └── api-response.interface.ts       # ApiListResponse<T> shared type
├── modules/
│   ├── project/
│   │   ├── project.entity.ts               # Project entity (no team_id)
│   │   ├── project-member.entity.ts        # ProjectMember + ProjectRole enum
│   │   ├── project.service.ts              # CRUD + member management + role checks
│   │   ├── project.controller.ts           # REST API with auth guards
│   │   ├── project.module.ts               # Module registration
│   │   └── dto/
│   │       ├── create-project.dto.ts       # name, description (no team_id, no created_by)
│   │       ├── update-project.dto.ts       # PartialType of create
│   │       └── manage-project-members.dto.ts # user_ids array
│   └── team/
│       ├── team.entity.ts                  # Team entity (project_id required)
│       ├── team-member.entity.ts           # TeamMember junction entity
│       ├── team.service.ts                 # Project-scoped CRUD + member management
│       ├── team.controller.ts              # Nested under /projects/:pid/teams
│       ├── team.module.ts                  # Module registration
│       └── dto/
│           ├── create-team.dto.ts          # name, description?, color?
│           └── add-team-member.dto.ts      # user_id
├── migrations/
│   └── 1743897600000-restructure-teams-project-scoped.ts
```

---

## 10. Raw PostgreSQL Queries

### Schema Definition

```sql
-- Project role enum
DO $$ BEGIN
  CREATE TYPE project_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Project members table
CREATE TABLE project_members (
    project_id  VARCHAR(8)    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        project_role  NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- Teams table (modified — add project_id)
ALTER TABLE teams ADD COLUMN project_id VARCHAR(8) NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_name_key;
ALTER TABLE teams ADD CONSTRAINT uq_teams_project_name UNIQUE (project_id, name);

-- Team members table
CREATE TABLE team_members (
    team_id     INT         NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  VARCHAR(8)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id),
    UNIQUE (user_id, project_id)
);

-- Removed columns
ALTER TABLE users DROP COLUMN IF EXISTS team_id;
ALTER TABLE projects DROP COLUMN IF EXISTS team_id;
```

### Index Creation

```sql
-- project_members
CREATE INDEX idx_project_members_user_id ON project_members (user_id);

-- teams
CREATE INDEX idx_teams_project_id ON teams (project_id);

-- team_members
CREATE INDEX idx_team_members_user_id ON team_members (user_id);
CREATE INDEX idx_team_members_project_id ON team_members (project_id);
```

### Rollback

```sql
ALTER TABLE teams ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE teams DROP CONSTRAINT IF EXISTS uq_teams_project_name;
ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name);

ALTER TABLE projects ADD COLUMN team_id INTEGER;
ALTER TABLE projects ADD CONSTRAINT fk_projects_team_id
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_team_id ON projects (team_id);

ALTER TABLE users ADD COLUMN team_id INTEGER;
ALTER TABLE users ADD CONSTRAINT fk_users_team_id
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX idx_users_team_id ON users (team_id);

DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS project_members;
DROP TYPE IF EXISTS project_role;

DROP INDEX IF EXISTS idx_teams_project_id;
ALTER TABLE teams DROP COLUMN IF EXISTS project_id;
```

### Example Queries

**Add a user as project owner:**
```sql
INSERT INTO project_members (project_id, user_id, role)
VALUES ('UrzWUH3e', '49566b0c-1107-42ae-935e-c5af04f6c450', 'owner');
```

**List all members of a project with their roles:**
```sql
SELECT pm.role, pm.joined_at,
       u.id, u.full_name, u.email, u.avatar_url
FROM project_members pm
JOIN users u ON u.id = pm.user_id
WHERE pm.project_id = 'UrzWUH3e'
ORDER BY pm.joined_at ASC;
```

**Check if a user has admin+ role in a project:**
```sql
SELECT 1 FROM project_members
WHERE project_id = 'UrzWUH3e'
  AND user_id = '49566b0c-1107-42ae-935e-c5af04f6c450'
  AND role IN ('owner', 'admin');
```

**Create a team in a project:**
```sql
INSERT INTO teams (name, description, color, project_id)
VALUES ('Backend Team', 'Server-side development', '#3B82F6', 'UrzWUH3e')
RETURNING *;
```

**List all teams in a project:**
```sql
SELECT id, name, description, color, is_active, created_at
FROM teams
WHERE project_id = 'UrzWUH3e'
ORDER BY created_at ASC;
```

**Add a user to a team (with project membership check):**
```sql
-- First verify project membership
SELECT 1 FROM project_members
WHERE project_id = 'UrzWUH3e' AND user_id = 'deee8651-9aa9-4496-a308-2a5983e7fa31';

-- Then insert (UNIQUE constraint prevents duplicate team assignment in same project)
INSERT INTO team_members (team_id, user_id, project_id)
VALUES (5, 'deee8651-9aa9-4496-a308-2a5983e7fa31', 'UrzWUH3e');
```

**List team members with user details:**
```sql
SELECT tm.joined_at,
       u.id, u.full_name, u.email, u.avatar_url
FROM team_members tm
JOIN users u ON u.id = tm.user_id
WHERE tm.team_id = 5 AND tm.project_id = 'UrzWUH3e'
ORDER BY tm.joined_at ASC;
```

**Find which team a user is on in a specific project:**
```sql
SELECT t.id, t.name, t.color, tm.joined_at
FROM team_members tm
JOIN teams t ON t.id = tm.team_id
WHERE tm.user_id = 'deee8651-9aa9-4496-a308-2a5983e7fa31'
  AND tm.project_id = 'UrzWUH3e';
```

**Remove a user from a project (cascading team cleanup):**
```sql
-- Remove from teams first
DELETE FROM team_members
WHERE project_id = 'UrzWUH3e'
  AND user_id = 'deee8651-9aa9-4496-a308-2a5983e7fa31';

-- Then remove from project
DELETE FROM project_members
WHERE project_id = 'UrzWUH3e'
  AND user_id = 'deee8651-9aa9-4496-a308-2a5983e7fa31';
```

**Count members per team in a project:**
```sql
SELECT t.id, t.name, COUNT(tm.user_id) AS member_count
FROM teams t
LEFT JOIN team_members tm ON tm.team_id = t.id
WHERE t.project_id = 'UrzWUH3e'
GROUP BY t.id, t.name
ORDER BY t.name;
```
