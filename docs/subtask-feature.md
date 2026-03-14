# Subtask Feature — Technical Documentation

> **Author:** Backend Engineering
> **Status:** Implemented
> **Module:** `TaskModule`
> **Stack:** NestJS 11 / TypeORM / PostgreSQL (Supabase)

---

## 1. Overview

### Purpose

The subtask feature extends the existing task system with hierarchical task decomposition. It allows users to break down a parent task into smaller, actionable subtasks directly on the kanban board.

### Problem it Solves

Large tasks often contain multiple discrete pieces of work. Without subtasks, teams either:

- Create many top-level tasks that clutter the board, or
- Track sub-items informally (e.g. checklists in the description field) with no status, assignees, or labels.

Subtasks give each sub-item first-class task semantics (status, priority, assignees, labels, ticket ID) while keeping the board clean by nesting them under a parent.

---

## 2. Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────┐
│                  TaskController                  │
│  POST /:id/subtasks    GET /:id/subtasks         │
│  POST /  (with parent_id)   PATCH /:id           │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼────────┐
              │   TaskService   │
              │  ┌────────────┐ │
              │  │ Validation │ │  ← depth limit, circular ref check
              │  └────────────┘ │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  TaskRepository  │
              │  (TypeORM)      │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   PostgreSQL    │
              │  tasks table    │  ← self-referencing FK (parent_id)
              │  ON DELETE      │
              │  CASCADE        │
              └─────────────────┘
```

### Integration with Existing Modules

The subtask feature is fully contained within the existing `TaskModule`. No new module, entity, or repository was introduced.

| Concern | Approach |
|---|---|
| **Entity** | Self-referencing `ManyToOne` / `OneToMany` on `Task` |
| **Table** | Same `tasks` table — subtask is a row with non-null `parent_id` |
| **Repository** | Same `TaskRepository` |
| **Module** | No changes to `task.module.ts` |
| **Ticket IDs** | Subtasks receive their own `ticket_id` (e.g. `KAN-16`) via the `trg_tasks_set_ticket_id` DB trigger. **Note:** This trigger is defined in `sql/kanban_tasks.sql` and must be installed manually — TypeORM (`synchronize: true`) does not manage triggers |
| **Existing endpoints** | `PATCH`, `DELETE`, assignees, labels, reorder, move — all work on subtasks as they are regular tasks |

---

## 3. API Design

### New Endpoints

#### `POST /api/tasks/:id/subtasks` — Create a subtask

Creates a subtask under the specified parent task. If `column_id` is omitted, it defaults to the parent's column.

**Path Parameters**

| Param | Type | Description |
|---|---|---|
| `id` | `UUID` | Parent task ID |

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Subtask title (max 255 chars) |
| `description` | `string` | No | Subtask description |
| `status` | `enum` | No | `open` \| `in_progress` \| `in_review` \| `done` \| `cancelled` (default: `open`) |
| `priority` | `enum` | No | `no_priority` \| `urgent` \| `high` \| `medium` \| `low` (default: `no_priority`) |
| `column_id` | `int` | No | Kanban column ID (defaults to parent's column) |
| `position` | `int` | No | Position within the column (default: `0`) |
| `team_id` | `int` | No | Team ID |
| `created_by` | `UUID` | No | Creator user ID |
| `due_date` | `ISO 8601` | No | Due date |
| `assignee_ids` | `UUID[]` | No | User UUIDs to assign |
| `label_ids` | `int[]` | No | Label IDs to attach |

**Example Request**

```bash
curl -X POST http://localhost:1996/api/tasks/a1b2c3d4-e5f6-7890-abcd-ef1234567890/subtasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Write unit tests for login form",
    "priority": "high",
    "assignee_ids": ["f47ac10b-58cc-4372-a567-0e02b2c3d479"]
  }'
```

**Response — `201 Created`**

```json
{
  "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "title": "Write unit tests for login form",
  "description": null,
  "status": "open",
  "priority": "high",
  "position": 0,
  "ticket_id": "KAN-17",
  "ticket_number": 17,
  "column_id": 1,
  "team_id": null,
  "parent_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "due_date": null,
  "created_at": "2025-03-14T10:30:00.000Z",
  "updated_at": "2025-03-14T10:30:00.000Z",
  "subtasks": [],
  "assignees": [
    { "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "name": "Jane Doe" }
  ],
  "labels": [],
  "creator": null
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `400` | Parent task is itself a subtask (depth > 1) |
| `404` | Parent task not found |

---

#### `GET /api/tasks/:id/subtasks` — List subtasks

Returns all subtasks of the specified parent task, ordered by `position ASC`.

**Path Parameters**

| Param | Type | Description |
|---|---|---|
| `id` | `UUID` | Parent task ID |

**Example Request**

```bash
curl http://localhost:1996/api/tasks/a1b2c3d4-e5f6-7890-abcd-ef1234567890/subtasks
```

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "title": "Write unit tests for login form",
      "status": "open",
      "priority": "high",
      "position": 0,
      "ticket_id": "KAN-17",
      "column_id": 1,
      "parent_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "subtasks": [],
      "assignees": [],
      "labels": [],
      "creator": null,
      "created_at": "2025-03-14T10:30:00.000Z",
      "updated_at": "2025-03-14T10:30:00.000Z"
    }
  ],
  "status": 200,
  "success": true
}
```

**Error Responses**

| Status | Condition |
|---|---|
| `404` | Parent task not found |

---

### Modified Endpoint Behavior

#### `POST /api/tasks` — Create a task (with optional `parent_id`)

The existing task creation endpoint now accepts an optional `parent_id` field. When provided, the new task is created as a subtask.

```json
{
  "title": "Subtask via direct create",
  "column_id": 1,
  "parent_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### `GET /api/tasks` — List all tasks

Now returns **only top-level tasks** (`parent_id IS NULL`). Subtasks are excluded from the main listing but included as a nested `subtasks` array on each parent task.

#### `GET /api/tasks/:id` — Get task by ID

Response now includes a `subtasks` array containing all direct child tasks.

#### `PATCH /api/tasks/:id` — Update a task

When updating `parent_id`:

- Setting `parent_id` to a valid top-level task ID converts the task into a subtask.
- Setting `parent_id` to `null` promotes a subtask to a top-level task.
- Setting `parent_id` to the task's own ID returns `400`.
- Setting `parent_id` to another subtask's ID returns `400` (depth limit).
- Setting `parent_id` on a task that already has subtasks returns `400` (would create grandchildren).

---

## 4. Database Design

### Table: `tasks`

The subtask feature adds a single column to the existing `tasks` table via a self-referencing foreign key.

#### New Column

| Column | Type | Nullable | Default | FK Reference | On Delete |
|---|---|---|---|---|---|
| `parent_id` | `UUID` | Yes | `NULL` | `tasks(id)` | `CASCADE` |

#### Entity Relationships (Self-Referencing)

```
tasks
├── parent_id  ──FK──►  tasks.id    (ManyToOne, nullable)
└── subtasks   ◄──────  tasks[]     (OneToMany, inverse)
```

- A task with `parent_id = NULL` is a **top-level task** (entity type: `string | null`).
- A task with `parent_id = <uuid>` is a **subtask**.
- Nesting is limited to **1 level** (enforced at application layer).

#### Constraints

| Constraint | Type | Description |
|---|---|---|
| `tasks_parent_id_fkey` | Foreign Key | `parent_id REFERENCES tasks(id)` |
| `ON DELETE CASCADE` | Referential Action | Deleting a parent auto-deletes all its subtasks |
| Depth limit (1 level) | Application-level | Service rejects subtask-of-subtask with `400` |

#### Index

| Index Name | Column | Purpose |
|---|---|---|
| `idx_tasks_parent_id` | `parent_id` | Accelerate subtask lookups and `IS NULL` filtering |

### ER Diagram (Relevant Relations)

```
┌──────────────────────┐
│        tasks         │
├──────────────────────┤
│ id           UUID PK │
│ title        VARCHAR │
│ description  TEXT     │
│ status       ENUM    │
│ priority     ENUM    │
│ position     INT     │
│ ticket_id    VARCHAR │
│ column_id    INT  FK │──► kanban_columns.id
│ team_id      INT  FK │──► teams.id
│ created_by   UUID FK │──► users.id
│ parent_id    UUID FK │──┐ (self-referencing)
│ due_date     TIMESTAMPTZ │
│ created_at   TIMESTAMPTZ │
│ updated_at   TIMESTAMPTZ │
└──────────────────────┘◄──┘
         │
         │ ManyToMany
         ▼
   task_assignees       task_labels
   (task_id, user_id)   (task_id, label_id)
```

---

## 5. Service Logic

### Main Business Logic Flow

#### Creating a Subtask (`createSubtask`)

```
Request ──► Resolve parent task (findOneById)
         ──► Validate parent (must exist, must NOT have parent_id)
         ──► Default column_id from parent if not provided
         ──► Delegate to create() with parent_id injected
         ──► create() validates parent_id again, resolves column
         ──► Save task row with parent_id set
         ──► Return full task with relations (findOneById)
```

#### Listing Top-Level Tasks (`findAll`)

```
Request ──► Query tasks WHERE parent_id IS NULL
         ──► Load relations: assignees, labels, creator, subtasks
         ──► Return array (subtasks nested under each parent)
```

#### Listing Subtasks (`findSubtasks`)

```
Request ──► Verify parent task exists (ensureTaskExists)
         ──► Query tasks WHERE parent_id = :parentId
         ──► Order by position ASC
         ──► Load relations: assignees, labels, creator, subtasks
         ──► Return envelope { data: Task[], status: 200, success: true }
```

### Validation Rules

| Rule | Enforced In | Error |
|---|---|---|
| Parent task must exist | `validateParent()` | `404 Not Found` |
| Parent must not itself be a subtask | `validateParent()` | `400 Bad Request` |
| Task cannot be its own parent | `update()` | `400 Bad Request` |
| Task with existing subtasks cannot become a subtask | `update()` | `400 Bad Request` |
| Max nesting depth = 1 | `validateParent()` | `400 Bad Request` |

### Edge Cases

| Scenario | Behavior |
|---|---|
| Create subtask of a subtask | Rejected with `400: Cannot create a subtask of a subtask (max depth is 1)` |
| Demote a task with subtasks to a subtask | Rejected with `400: Cannot make a task a subtask when it has its own subtasks (would exceed max depth of 1)` |
| Delete parent task | All subtasks are cascade-deleted at DB level |
| Move subtask to another column | Works normally (subtask is a regular task) |
| Assign labels/users to subtask | Works normally via existing endpoints |
| Update task to set `parent_id` to own ID | Rejected with `400: A task cannot be its own parent` |
| `GET /api/tasks` after creating subtasks | Subtasks do not appear in top-level listing |
| Subtask `ticket_id` | Generated automatically by the existing DB trigger (`fn_set_ticket_id`). Requires the trigger to be installed in the database — see `sql/kanban_tasks.sql` |

---

## 6. Security Considerations

### Authentication / Authorization

The subtask endpoints follow the same auth pattern as the existing task endpoints. Currently, the API does not enforce per-task ownership checks — any authenticated user can create or read subtasks for any task. If role-based access control (RBAC) is introduced in the future, it should be applied uniformly across all task endpoints, including subtask operations.

### Input Validation

All input is validated via NestJS's global `ValidationPipe`:

```typescript
new ValidationPipe({
  whitelist: true,            // Strip unknown properties
  forbidNonWhitelisted: true, // Reject requests with unknown properties
  transform: true,            // Auto-transform payloads to DTO instances
})
```

| Field | Validation |
|---|---|
| `title` | `@IsString()`, `@IsNotEmpty()`, `@MaxLength(255)` |
| `parent_id` | `@IsOptional()`, `@IsUUID()` |
| `column_id` | `@IsOptional()`, `@IsInt()` (on `CreateSubtaskDto`) |
| Path `:id` | `ParseUUIDPipe` — rejects malformed UUIDs before hitting the service |

The `whitelist: true` + `forbidNonWhitelisted: true` configuration ensures that:

- Only declared DTO properties are accepted.
- Any extra fields in the request body result in a `400 Bad Request`.

### SQL Injection

All database queries go through TypeORM's parameterized query builder. No raw string interpolation is used. The `parent_id` foreign key constraint provides an additional guard — only valid existing UUIDs from the `tasks` table are accepted.

---

## 7. Performance Considerations

### Query Optimization

| Query | Optimization |
|---|---|
| `findAll()` — top-level tasks | `WHERE parent_id IS NULL` uses the `idx_tasks_parent_id` index (B-tree indexes support `IS NULL` scans in PostgreSQL) |
| `findSubtasks()` — children of a parent | `WHERE parent_id = :id` is a direct index lookup on `idx_tasks_parent_id` |
| `validateParent()` | Uses `SELECT id, parent_id` (column projection) to minimize data transfer |
| `ensureTaskExists()` | Uses `existsBy()` which generates `SELECT 1 ... LIMIT 1` |

### Index Strategy

| Index | Column(s) | Type | Purpose |
|---|---|---|---|
| `idx_tasks_parent_id` | `parent_id` | B-tree | Subtask lookups, `IS NULL` filtering for top-level listing |
| `idx_tasks_column_id` | `column_id` | B-tree | (Pre-existing) Column-based queries |
| `idx_tasks_status` | `status` | B-tree | (Pre-existing) Status filtering |

The `idx_tasks_parent_id` index is sufficient for both use cases:

1. **Top-level listing:** `WHERE parent_id IS NULL` — PostgreSQL B-tree indexes include `NULL` values, so this is an index scan.
2. **Subtask lookup:** `WHERE parent_id = <uuid>` — direct equality lookup on the index.

### Cascade Delete Performance

`ON DELETE CASCADE` is handled at the PostgreSQL level, which is significantly faster than application-level cascading (no extra round trips). For a parent with N subtasks, deletion is a single DB operation.

---

## 8. Future Improvements

### Possible Enhancements

| Enhancement | Description |
|---|---|
| **Subtask progress tracking** | Compute parent task completion percentage based on subtask statuses (e.g. 3/5 done = 60%) |
| **Subtask count in listing** | Add a `subtask_count` virtual column or aggregation to `findAll()` to show counts without loading full subtask arrays |
| **Bulk subtask creation** | `POST /api/tasks/:id/subtasks/bulk` to create multiple subtasks in a single request |
| **Subtask templates** | Predefined subtask sets that can be applied to a parent task (e.g. "QA Checklist" adds 5 standard subtasks) |
| **Drag-and-drop reorder** | Dedicated `PATCH /api/tasks/:id/subtasks/reorder` endpoint with positional array |
| **Convert subtask to task** | Promote a subtask to a top-level task (set `parent_id = NULL` via `PATCH`) — already supported |
| **Convert task to subtask** | Demote a top-level task to a subtask of another task — already supported via `PATCH` with `parent_id` |

### Scalability Considerations

| Concern | Recommendation |
|---|---|
| **Large subtask counts** | If a parent task accumulates hundreds of subtasks, add pagination to `GET /:id/subtasks` (`?page=1&limit=20`) |
| **Deep nesting** | Current 1-level limit is enforced in the application layer. If multi-level nesting is needed in the future, consider a `materialized path` or `closure table` pattern instead of recursive self-joins |
| **N+1 on subtasks relation** | The `subtasks` relation is eagerly loaded on `findAll()`. If the task count grows large, switch to a lazy-load or separate query strategy |
| **Index bloat** | The `idx_tasks_parent_id` index will grow with the task count. PostgreSQL handles this well, but monitor index size via `pg_relation_size('idx_tasks_parent_id')` |

---

## 9. Raw PostgreSQL Queries

### Schema Definition (Migration)

```sql
-- Add parent_id column with self-referencing foreign key
ALTER TABLE tasks
  ADD COLUMN parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

-- Create index for subtask lookups and IS NULL filtering
CREATE INDEX idx_tasks_parent_id ON tasks (parent_id);
```

### Rollback

```sql
DROP INDEX idx_tasks_parent_id;
ALTER TABLE tasks DROP COLUMN parent_id;
```

### Queries Used by the Feature

#### Insert a subtask

```sql
-- Created via TypeORM repository.save()
INSERT INTO tasks (id, title, description, status, priority, position, column_id, parent_id, created_by)
VALUES (
  gen_random_uuid(),
  'Write unit tests',
  NULL,
  'open',
  'no_priority',
  0,
  1,
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',  -- parent task ID
  NULL
)
RETURNING *;
```

#### Fetch top-level tasks only (excludes subtasks)

```sql
-- Used by findAll()
SELECT t.*,
       json_agg(DISTINCT u.*) AS assignees,
       json_agg(DISTINCT l.*) AS labels
FROM tasks t
LEFT JOIN task_assignees ta ON ta.task_id = t.id
LEFT JOIN users u ON u.id = ta.user_id
LEFT JOIN task_labels tl ON tl.task_id = t.id
LEFT JOIN labels l ON l.id = tl.label_id
WHERE t.parent_id IS NULL
GROUP BY t.id;
```

#### Fetch subtasks of a parent

```sql
-- Used by findSubtasks()
SELECT t.*
FROM tasks t
WHERE t.parent_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
ORDER BY t.position ASC;
```

#### Fetch a single task with its subtasks

```sql
-- Used by findOneById() — TypeORM generates two queries:
-- 1. Main task
SELECT * FROM tasks WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- 2. Subtasks (relation loading)
SELECT * FROM tasks WHERE parent_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

#### Validate parent is not itself a subtask

```sql
-- Used by validateParent()
SELECT id, parent_id
FROM tasks
WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
-- If parent_id IS NOT NULL → reject (depth limit exceeded)
```

#### Cascade delete (automatic)

```sql
-- When a parent task is deleted:
DELETE FROM tasks WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
-- PostgreSQL automatically executes:
-- DELETE FROM tasks WHERE parent_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

#### Useful diagnostic queries

```sql
-- Count subtasks per parent
SELECT parent_id, COUNT(*) AS subtask_count
FROM tasks
WHERE parent_id IS NOT NULL
GROUP BY parent_id
ORDER BY subtask_count DESC;

-- Find orphaned subtasks (parent was deleted without cascade — should not happen)
SELECT t.id, t.title, t.parent_id
FROM tasks t
LEFT JOIN tasks p ON p.id = t.parent_id
WHERE t.parent_id IS NOT NULL AND p.id IS NULL;

-- Check index size
SELECT pg_size_pretty(pg_relation_size('idx_tasks_parent_id')) AS index_size;
```
