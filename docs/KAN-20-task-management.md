# KAN-20: Kanban Task Management System

## Overview

This document describes the implementation of the core task management system for the Kanban board backend. The commit introduces four new NestJS feature modules — **Columns**, **Labels**, **Tasks**, and **Board** — along with the supporting PostgreSQL schema, providing full CRUD for kanban columns, labels, and tasks, plus a composite board endpoint that powers the Kanban UI in a single request.

### Purpose

Prior to this change the backend only had Users, Teams, and Auth modules. There was no way to represent work items on a board. This commit adds:

- **Kanban columns** — the vertical lanes of the board (Backlog, Todo, In Progress, etc.)
- **Labels** — color-coded tags that can be attached to tasks
- **Tasks** — the work items themselves, with status, priority, position ordering, assignees, and labels
- **Board endpoint** — a composite read-only endpoint that returns the entire board state (all columns with their tasks, assignees, and labels) with filtering and per-column pagination

### Problems Solved

| Problem | Solution |
|---------|----------|
| No representation of work items | `tasks` table with status, priority, position ordering |
| No way to categorize tasks | `labels` table + `task_labels` many-to-many join |
| No way to assign people to tasks | `task_assignees` many-to-many join |
| Frontend needs entire board in one request | `GET /api/board` composite endpoint |
| Frontend needs server-side filtering | Query params for priority, search, assignee, label |
| Large boards need pagination | Per-column `tasksPerColumn` limit pushed to database via `ROW_NUMBER()` |
| Ticket ID generation race condition | Database trigger (`fn_set_ticket_id`) sets `ticket_id` atomically on insert |

---

## Architecture & Design

### Module Structure

```
src/modules/
├── kanban-column/          # Column CRUD
│   ├── dto/
│   │   ├── create-kanban-column.dto.ts
│   │   └── update-kanban-column.dto.ts
│   ├── kanban-column.entity.ts
│   ├── kanban-column.controller.ts
│   ├── kanban-column.service.ts
│   └── kanban-column.module.ts
├── label/                  # Label CRUD
│   ├── dto/
│   │   ├── create-label.dto.ts
│   │   └── update-label.dto.ts
│   ├── label.entity.ts
│   ├── label.controller.ts
│   ├── label.service.ts
│   └── label.module.ts
├── task/                   # Task CRUD + relation management
│   ├── dto/
│   │   ├── create-task.dto.ts
│   │   ├── update-task.dto.ts
│   │   ├── manage-assignees.dto.ts
│   │   └── manage-labels.dto.ts
│   ├── task.entity.ts
│   ├── task.controller.ts
│   ├── task.service.ts
│   └── task.module.ts
└── board/                  # Composite read-only endpoint
    ├── dto/
    │   ├── board-query.dto.ts
    │   └── board-response.dto.ts
    ├── board.controller.ts
    ├── board.service.ts
    └── board.module.ts
```

### High-Level Flow

```
Client Request
     │
     ▼
Controller (validation via DTOs + ValidationPipe)
     │
     ▼
Service (business logic, QueryBuilder)
     │
     ▼
TypeORM Repository ─── PostgreSQL
```

All four modules follow the same pattern:
1. **Controller** — route handling, Swagger decorators, param validation (`ParseUUIDPipe`, `ParseIntPipe`)
2. **Service** — business logic, error handling with `try/catch`, `Logger`, and typed exceptions
3. **Repository** — TypeORM `Repository<Entity>` injected via `@InjectRepository()`

### Key Design Decisions

**1. Board module imports entities directly, not other modules**

`BoardModule` uses `TypeOrmModule.forFeature([KanbanColumn, Task])` to get its own repository instances. It does not import `KanbanColumnModule` or `TaskModule`, avoiding circular dependencies and service coupling.

**2. Subqueries for assignee/label filtering on the board**

When filtering tasks by assignee or label, the board service uses `IN (SELECT ...)` subqueries instead of `INNER JOIN`:

```typescript
// Subquery approach — filters tasks while preserving ALL assignees in results
taskQb.andWhere(
  't.id IN (SELECT task_id FROM task_assignees WHERE user_id = :assigneeId)',
);
```

If we used `INNER JOIN` for filtering, only the matching assignee/label would appear in the response. The subquery filters which tasks match while the `LEFT JOIN` still loads all related assignees and labels.

**3. Two-query strategy for the board endpoint**

Instead of fetching all matching tasks and slicing in JS, the board service runs two optimized queries:

- **Query 1 (Count):** Lightweight `COUNT(*) GROUP BY column_id` — provides `task_count` per column
- **Query 2 (Tasks):** Uses `ROW_NUMBER() OVER (PARTITION BY column_id ORDER BY position)` to fetch only the top N tasks per column at the database level, then joins assignees/labels only for those rows

Both queries share the same filter conditions built once as raw SQL strings.

**4. Ticket ID generation via database trigger**

A `BEFORE INSERT` trigger on the `tasks` table atomically sets `ticket_id = 'KAN-' || ticket_number`, eliminating the need for a second `UPDATE` after insert and preventing race conditions under concurrent inserts.

**5. Foreign key validation in the service layer**

`TaskService.create()` calls `resolveColumn(column_id)` before saving, returning a clear `404 Not Found` with message `Column with id "X" not found` instead of letting the FK constraint produce a generic database error.

**6. Column deletion protection**

`KanbanColumnService.remove()` handles PostgreSQL error code `23503` (FK violation) and returns `409 Conflict` with `"Cannot delete column with existing tasks"`.

---

## Database Changes

### Entity-Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │  task_assignees   │       │    tasks     │
│──────────────│       │──────────────────│       │──────────────│
│ id (UUID) PK │◄──────│ user_id (FK)     │──────►│ id (UUID) PK │
│ full_name    │       │ task_id (FK)     │       │ title        │
│ avatar_url   │       │ assigned_at      │       │ description  │
│ ...          │       └──────────────────┘       │ status       │
└──────────────┘                                   │ priority     │
                                                   │ position     │
┌──────────────┐       ┌──────────────────┐       │ ticket_number│
│   labels     │       │   task_labels    │       │ ticket_id    │
│──────────────│       │──────────────────│       │ column_id(FK)│──►┌────────────────┐
│ id (UUID) PK │◄──────│ label_id (FK)    │──────►│ team_id (FK) │   │ kanban_columns │
│ name         │       │ task_id (FK)     │       │ created_by   │   │────────────────│
│ color        │       │ assigned_at      │       │ created_at   │   │ id (SERIAL) PK │
└──────────────┘       └──────────────────┘       │ updated_at   │   │ name (UNIQUE)  │
                                                   └──────────────┘   │ position       │
                                                                      │ color          │
                                                                      │ is_archived    │
                                                                      └────────────────┘
```

### New Tables

#### `kanban_columns`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `SERIAL` | Primary key |
| `name` | `VARCHAR(100)` | `NOT NULL`, `UNIQUE` |
| `position` | `INT` | `NOT NULL`, `DEFAULT 0`, `CHECK >= 0` |
| `color` | `VARCHAR(20)` | Nullable, hex color for UI |
| `is_archived` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` |
| `created_at` | `TIMESTAMPTZ` | Auto-set |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated via trigger |

#### `labels`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | Primary key, `gen_random_uuid()` |
| `name` | `VARCHAR(50)` | `NOT NULL`, `UNIQUE` |
| `color` | `VARCHAR(20)` | `NOT NULL`, `CHECK` regex `^#[0-9A-Fa-f]{6}$` |
| `created_at` | `TIMESTAMPTZ` | Auto-set |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated via trigger |

#### `tasks`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | Primary key, `gen_random_uuid()` |
| `title` | `VARCHAR(255)` | `NOT NULL` |
| `description` | `TEXT` | Nullable |
| `status` | `task_status` enum | `NOT NULL`, `DEFAULT 'open'` |
| `priority` | `task_priority` enum | `NOT NULL`, `DEFAULT 'no_priority'` |
| `position` | `INT` | `NOT NULL`, `DEFAULT 0`, `CHECK >= 0` |
| `ticket_number` | `SERIAL` | `NOT NULL`, `UNIQUE` |
| `ticket_id` | `VARCHAR(20)` | `UNIQUE`, set by trigger |
| `column_id` | `INT` | `NOT NULL`, FK → `kanban_columns(id)` `ON DELETE RESTRICT` |
| `team_id` | `INT` | Nullable, FK → `teams(id)` `ON DELETE SET NULL` |
| `created_by` | `UUID` | Nullable, FK → `users(id)` `ON DELETE SET NULL` |
| `created_at` | `TIMESTAMPTZ` | Auto-set |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated via trigger |

#### `task_assignees` (join table)

| Column | Type | Constraints |
|--------|------|-------------|
| `task_id` | `UUID` | FK → `tasks(id)` `ON DELETE CASCADE` |
| `user_id` | `UUID` | FK → `users(id)` `ON DELETE CASCADE` |
| `assigned_at` | `TIMESTAMPTZ` | `DEFAULT CURRENT_TIMESTAMP` |

Composite primary key: `(task_id, user_id)`

#### `task_labels` (join table)

| Column | Type | Constraints |
|--------|------|-------------|
| `task_id` | `UUID` | FK → `tasks(id)` `ON DELETE CASCADE` |
| `label_id` | `UUID` | FK → `labels(id)` `ON DELETE CASCADE` |
| `assigned_at` | `TIMESTAMPTZ` | `DEFAULT CURRENT_TIMESTAMP` |

Composite primary key: `(task_id, label_id)`

### Enums

```sql
CREATE TYPE task_priority AS ENUM ('no_priority', 'urgent', 'high', 'medium', 'low');
CREATE TYPE task_status   AS ENUM ('open', 'in_progress', 'in_review', 'done', 'cancelled');
```

### Indexes

| Index | Table | Columns | Notes |
|-------|-------|---------|-------|
| `idx_kanban_columns_position` | `kanban_columns` | `position` | Partial: `WHERE is_archived = FALSE` |
| `idx_tasks_column_id` | `tasks` | `column_id` | FK lookup |
| `idx_tasks_column_position` | `tasks` | `(column_id, position)` | Partial: `WHERE status != 'cancelled'` |
| `idx_tasks_status` | `tasks` | `status` | Filter queries |
| `idx_tasks_priority` | `tasks` | `priority` | Filter queries |
| `idx_tasks_team_id` | `tasks` | `team_id` | FK lookup |
| `idx_tasks_created_by` | `tasks` | `created_by` | FK lookup |
| `idx_tasks_ticket_number` | `tasks` | `ticket_number` | Unique |
| `idx_task_assignees_user_id` | `task_assignees` | `user_id` | Reverse lookup (find tasks by user) |
| `idx_task_labels_label_id` | `task_labels` | `label_id` | Reverse lookup (find tasks by label) |

### Triggers

| Trigger | Table | Event | Function | Purpose |
|---------|-------|-------|----------|---------|
| `trg_tasks_set_ticket_id` | `tasks` | `BEFORE INSERT` | `fn_set_ticket_id()` | Sets `ticket_id = 'KAN-' \|\| ticket_number` atomically |
| `trg_tasks_updated_at` | `tasks` | `BEFORE UPDATE` | `fn_update_timestamp()` | Auto-updates `updated_at` |
| `trg_kanban_columns_updated_at` | `kanban_columns` | `BEFORE UPDATE` | `fn_update_timestamp()` | Auto-updates `updated_at` |
| `trg_labels_updated_at` | `labels` | `BEFORE UPDATE` | `fn_update_timestamp()` | Auto-updates `updated_at` |

### Helper Functions

| Function | Purpose |
|----------|---------|
| `fn_swap_column_positions(a, b)` | Swap positions of two columns |
| `fn_move_task(task_id, new_col, new_pos)` | Move a task to a different column at a specific position |
| `fn_reorder_task(task_id, new_pos)` | Reorder a task within its current column |

All helper functions validate that the referenced entity exists and `RAISE EXCEPTION` if not found.

### Seed Data

5 default columns (Backlog, Todo, In Progress, In Review, Done) and 8 default labels (Bug, Feature, Improvement, Hotfix, Documentation, Design, DevOps, Research).

---

## API Changes

All endpoints are prefixed with `/api` (global prefix set in `main.ts`).

### Columns — `@Controller('columns')`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/columns` | Create a column |
| `GET` | `/api/columns` | List active columns (sorted by position) |
| `GET` | `/api/columns/:id` | Get column by ID |
| `PATCH` | `/api/columns/:id` | Update a column |
| `DELETE` | `/api/columns/:id` | Delete a column (fails if tasks exist) |

**Create Column Request:**
```json
{
  "name": "QA Testing",
  "position": 5,
  "color": "#F43F5E"
}
```

### Labels — `@Controller('labels')`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/labels` | Create a label |
| `GET` | `/api/labels` | List all labels |
| `GET` | `/api/labels/:id` | Get label by UUID |
| `PATCH` | `/api/labels/:id` | Update a label |
| `DELETE` | `/api/labels/:id` | Delete a label |

**Create Label Request:**
```json
{
  "name": "Backend",
  "color": "#6366F1"
}
```

### Tasks — `@Controller('tasks')`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks` | Create a task |
| `GET` | `/api/tasks` | List all tasks (with assignees & labels) |
| `GET` | `/api/tasks/:id` | Get task by UUID (with assignees & labels) |
| `PATCH` | `/api/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `POST` | `/api/tasks/:id/assignees` | Add assignees |
| `DELETE` | `/api/tasks/:id/assignees` | Remove assignees |
| `POST` | `/api/tasks/:id/labels` | Add labels |
| `DELETE` | `/api/tasks/:id/labels` | Remove labels |

**Create Task Request:**
```json
{
  "title": "Implement login page",
  "description": "Build the login form with validation",
  "column_id": 2,
  "priority": "high",
  "position": 0,
  "assignee_ids": ["uuid-1", "uuid-2"],
  "label_ids": ["uuid-3"]
}
```

**Manage Assignees/Labels Request:**
```json
{
  "user_ids": ["uuid-1", "uuid-2"]
}
```
```json
{
  "label_ids": ["uuid-3", "uuid-4"]
}
```

Both `user_ids` and `label_ids` arrays must be non-empty (`@ArrayNotEmpty()`).

### Board — `@Controller('board')`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/board` | Get full board state |

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tasksPerColumn` | `number` | `50` | Max tasks per column (1–200) |
| `assigneeId` | `UUID string` | — | Filter tasks by assignee |
| `priority` | `TaskPriority` | — | Filter tasks by priority |
| `labelId` | `UUID string` | — | Filter tasks by label |
| `search` | `string` | — | Case-insensitive partial match on title |

All filters combine with AND logic.

**Example Request:**
```
GET /api/board?tasksPerColumn=10&priority=high&search=login
```

**Response Shape:**
```json
{
  "columns": [
    {
      "id": 1,
      "name": "Todo",
      "position": 1,
      "color": "#3B82F6",
      "task_count": 42,
      "tasks": [
        {
          "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          "title": "Implement login page",
          "ticket_id": "KAN-1",
          "position": 0,
          "status": "open",
          "priority": "high",
          "created_at": "2025-01-15T10:30:00.000Z",
          "assignees": [
            {
              "id": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
              "full_name": "John Doe",
              "avatar_url": "https://api.dicebear.com/9.x/initials/svg?seed=JD"
            }
          ],
          "labels": [
            {
              "id": "d4c3b2a1-e5f6-7890-abcd-ef1234567890",
              "name": "Feature",
              "color": "#3B82F6"
            }
          ]
        }
      ]
    }
  ]
}
```

Key notes:
- `task_count` reflects the **total** number of matching tasks in the column (not limited by `tasksPerColumn`)
- `tasks` array is capped at `tasksPerColumn`, sorted by `position ASC`
- Tasks intentionally **exclude `description`** (fetched separately via `GET /api/tasks/:id`)
- Columns are sorted by `position ASC`; only non-archived columns are returned
- When filtering by assignee or label, all assignees/labels are still returned on each matching task (not just the filtered one)

---

## Security & Performance Considerations

### Input Validation

- All DTOs use `class-validator` decorators with a global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`)
- UUID params are validated via `ParseUUIDPipe`; integer params via `ParseIntPipe`
- Column and label colors are validated against `/^#[0-9A-Fa-f]{6}$/`
- `tasksPerColumn` is bounded to 1–200
- Assignee/label arrays require `@ArrayNotEmpty()` on manage endpoints

### SQL Injection Prevention

- All database queries use parameterized values (`:paramName` syntax in TypeORM QueryBuilder)
- The `search` filter escapes `\`, `%`, and `_` characters before passing to `ILIKE`:
  ```typescript
  const escaped = query.search
    .replaceAll('\\', '\\\\')
    .replaceAll(/[%_]/g, String.raw`\$&`);
  ```

### Query Efficiency

- **Board count query** uses `COUNT(*) GROUP BY` with no joins — lightweight aggregate
- **Board task query** uses `ROW_NUMBER() OVER (PARTITION BY column_id)` to limit per-column results at the database level, avoiding loading thousands of tasks into memory
- The composite `(column_id, position)` partial index accelerates both ordering and the `ROW_NUMBER()` window function
- Assignee/label filter subqueries leverage the `user_id` and `label_id` indexes on join tables

### Authentication

This commit does not add authentication guards to the new endpoints. The existing `AuthModule` provides JWT infrastructure, but guards should be applied in a follow-up once the auth flow is finalized.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No columns exist | Board returns `{ "columns": [] }` |
| Column has no tasks | Column appears with `task_count: 0`, `tasks: []` |
| All tasks filtered out | Columns still appear, each with `task_count: 0` |
| Delete column with tasks | `409 Conflict`: "Cannot delete column with existing tasks" |
| Create task with invalid `column_id` | `404 Not Found`: "Column with id X not found" |
| Remove non-existent assignee IDs | `404 Not Found` listing missing UUIDs |
| Empty assignee/label arrays | `400 Bad Request` from DTO validation |
| Search with special chars (`%`, `_`, `\`) | Properly escaped, treated as literals |

---

## Migration & Compatibility

### Backward Compatibility

- **No breaking changes** to existing endpoints. The Users, Teams, and Auth modules are unaffected.
- All new tables and enums are additive — no modifications to existing database objects.
- The `fn_update_timestamp()` function (from the users migration) is reused by the new triggers.

### Deployment Steps

1. **Run the SQL schema** (`sql/kanban_tasks.sql`) against your PostgreSQL database. This script:
   - Creates enums, tables, indexes, triggers, helper functions, and seed data
   - Depends on `users` table and `fn_update_timestamp()` function existing first

2. **Deploy the application** — all new modules are auto-registered via `AppModule` imports. TypeORM `autoLoadEntities: true` discovers the new entities automatically.

3. **Verify** at `/api/docs` (Swagger UI) — four new tags should appear: Columns, Labels, Tasks, Board.

### Things to Watch

- The `fn_set_ticket_id` trigger must exist before creating tasks, otherwise `ticket_id` will be `NULL`
- If deploying to an existing database that already has tasks created with the old two-save approach, existing `ticket_id` values are unaffected (they were already set correctly)
- `synchronize: true` is enabled in non-production environments — TypeORM will auto-create tables from entities, but the SQL file should still be run for triggers, helper functions, seed data, and partial indexes that TypeORM cannot generate
- The `SERIAL` column `ticket_number` may have gaps after rolled-back transactions — this is expected and standard behavior for PostgreSQL sequences
