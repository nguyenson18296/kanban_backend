# Task Activity System — Technical Documentation

**Feature:** Task Activity (Audit Log) System
**Module:** `ActivityModule`
**Author:** Backend Engineering
**Date:** 2026-04-04
**Stack:** NestJS 11 / TypeORM / PostgreSQL / @nestjs/event-emitter

---

## 1. Overview

### Purpose

A centralized, event-driven activity logging system that records every action performed on a task. Activities are immutable audit records — once created, they cannot be edited or deleted. They provide a complete, chronological history of task changes.

### Problem It Solves

- **No audit trail:** Previously, there was no way to see who changed what on a task or when
- **Lack of transparency:** Team members couldn't track the history of task modifications (status changes, reassignments, priority shifts)
- **Accountability gaps:** Without a log, it was impossible to determine who moved a task, changed its due date, or removed an assignee
- **Separate from notifications:** The existing notification system serves a different purpose (alerting users). Activities are a permanent record, while notifications are ephemeral and user-deletable

---

## 2. Architecture

### High-Level System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                        Producer Module                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     TaskService                           │    │
│  │                                                           │    │
│  │  create()  update()  addAssignees()  removeAssignees()   │    │
│  │  addLabels()  removeLabels()  move()  reorder()          │    │
│  │  createSubtask()                                          │    │
│  └────────────────────────┬──────────────────────────────────┘    │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              EventEmitter2 (Event Bus)                     │    │
│  │                                                           │    │
│  │  activity.task.created          activity.task.moved       │    │
│  │  activity.task.title_updated    activity.task.reordered   │    │
│  │  activity.task.status_changed   activity.task.label_added │    │
│  │  activity.task.priority_changed ...and 5 more             │    │
│  └─────────────────────────┬─────────────────────────────────┘    │
└────────────────────────────┼──────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       ActivityModule                              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ActivityListener                                         │    │
│  │  @OnEvent('activity.task.created')      → create()       │    │
│  │  @OnEvent('activity.task.title_updated') → create()      │    │
│  │  @OnEvent('activity.task.status_changed') → create()     │    │
│  │  ... (12 event handlers, all delegate to create())        │    │
│  └──────────────────────┬────────────────────────────────────┘    │
│                          │                                        │
│                          ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ActivityService                                          │    │
│  │  create()     — persist a single activity record          │    │
│  │  findByTask() — paginated query with optional filter      │    │
│  └──────────────────────┬────────────────────────────────────┘    │
│                          │                                        │
│                          ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ActivityController (REST API)                            │    │
│  │  GET /tasks/:taskId/activities                            │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL — task_activities table (JSONB payload)               │
└──────────────────────────────────────────────────────────────────┘
```

### Why Event-Driven

- **Loose coupling** — `TaskService` doesn't import `ActivityModule`. It emits events, and the listener picks them up
- **Non-blocking** — Activity creation failures don't break the primary operation (fire-and-forget)
- **Extensible** — Adding new consumers (e.g., analytics, webhooks) requires zero changes to the producer
- **Consistent** — Follows the same pattern as the existing `NotificationModule`

### Module Interaction

```
AppModule
├── EventEmitterModule.forRoot()   ← Global event bus
├── TaskModule                     ← Producer: emits activity.task.* events
├── NotificationModule             ← Parallel consumer (notification.* events)
└── ActivityModule                 ← Consumer: listens to activity.task.* events
    ├── imports: [TypeOrmModule.forFeature([Activity, Task])]
    ├── controllers: [ActivityController]
    ├── providers: [ActivityService, ActivityListener]
    └── exports: [ActivityService]
```

### Event Emission Points

| TaskService Method   | Activity Event(s)                                                                                           |
|----------------------|-------------------------------------------------------------------------------------------------------------|
| `create()`           | `task_created`                                                                                              |
| `createSubtask()`    | `task_created` (via `create()`)                                                                             |
| `update()`           | `task_title_updated`, `task_description_updated`, `task_status_changed`, `task_priority_changed`, `task_due_date_changed`, `task_assignee_added`, `task_assignee_removed`, `task_label_added`, `task_label_removed` — only for fields that actually changed |
| `addAssignees()`     | `task_assignee_added` (single record with array of users)                                                   |
| `removeAssignees()`  | `task_assignee_removed` (single record with array of users)                                                 |
| `addLabels()`        | `task_label_added` (single record with array of labels)                                                     |
| `removeLabels()`     | `task_label_removed` (single record with array of labels)                                                   |
| `move()`             | `task_moved`                                                                                                |
| `reorder()`          | `task_reordered`                                                                                            |

### Change Detection in `update()`

The `update()` method receives a partial DTO. Previous values are captured before `Object.assign()` mutates the entity. Each field is compared individually — events are only emitted for fields that actually changed:

```
if dto.status !== undefined && dto.status !== previousStatus       → emit task_status_changed
if dto.title !== undefined && dto.title !== previousTitle          → emit task_title_updated
if dto.description !== undefined && dto.description !== previousDescription → emit task_description_updated
if dto.priority !== undefined && dto.priority !== previousPriority → emit task_priority_changed
if dto.due_date !== undefined && normalized(dto.due_date) !== normalized(previousDueDate) → emit task_due_date_changed
if dto.assignee_ids !== undefined → diff previous vs new assignee lists → emit added/removed
if dto.label_ids !== undefined → diff previous vs new label lists → emit added/removed
```

Due date comparison normalizes both sides to `getTime()` (milliseconds) to avoid format-dependent false positives between Date objects and ISO strings.

---

## 3. API Design

### Endpoint Summary

All endpoints require JWT authentication.

| Method | Endpoint                          | Description                          |
|--------|-----------------------------------|--------------------------------------|
| `GET`  | `/tasks/:taskId/activities`       | List activities for a task (paginated) |

### `GET /tasks/:taskId/activities`

**Query Parameters:**

| Param    | Type                 | Default | Description               |
|----------|----------------------|---------|---------------------------|
| `page`   | int                  | `1`     | Page number (1-based)     |
| `limit`  | int                  | `20`    | Items per page (max: 100) |
| `action` | `TaskActivityAction` | —       | Filter by activity type   |

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "action": "task_status_changed",
      "payload": {
        "from": "open",
        "to": "in_progress"
      },
      "actor": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "full_name": "Grace Bui",
        "avatar_url": "https://example.com/avatar.jpg"
      },
      "created_at": "2026-04-04T10:30:00.000Z"
    },
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "action": "task_assignee_added",
      "payload": {
        "users": [
          { "user_id": "uuid-1", "full_name": "John Doe" },
          { "user_id": "uuid-2", "full_name": "Jane Smith" }
        ]
      },
      "actor": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "full_name": "Grace Bui",
        "avatar_url": "https://example.com/avatar.jpg"
      },
      "created_at": "2026-04-04T10:25:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

> `task_id` and `actor_id` are excluded from the response via `toJSON()`. The `actor` relation provides the display data.

---

## 4. Database Design

### Table: `task_activities`

| Column       | Type                   | Nullable | Default             | Description                         |
|-------------|------------------------|----------|---------------------|-------------------------------------|
| `id`        | `UUID`                 | NO       | `gen_random_uuid()` | Primary key                         |
| `task_id`   | `UUID`                 | NO       | —                   | FK to `tasks(id)` ON DELETE CASCADE |
| `actor_id`  | `UUID`                 | NO       | —                   | FK to `users(id)` ON DELETE CASCADE |
| `action`    | `task_activity_action` | NO       | —                   | PostgreSQL ENUM                     |
| `payload`   | `JSONB`                | NO       | `'{}'`              | Context-specific data               |
| `created_at`| `TIMESTAMPTZ`          | NO       | `now()`             | When the activity occurred          |

No `updated_at` column — activities are immutable.

### Entity Relationship Diagram

```
┌──────────────┐       ┌────────────────────┐
│    users     │       │  task_activities    │
├──────────────┤       ├────────────────────┤
│ id (PK)      │◄──────│ actor_id (FK)      │
│ full_name    │       │ id (PK)            │
│ email        │       │ task_id (FK)       │──┐
│ avatar_url   │       │ action             │  │
│ ...          │       │ payload (JSONB)     │  │
└──────────────┘       │ created_at         │  │
                       └────────────────────┘  │
┌──────────────┐                                │
│    tasks     │                                │
├──────────────┤                                │
│ id (PK)      │◄───────────────────────────────┘
│ title        │
│ status       │
│ ...          │
└──────────────┘
```

### Indexes

| Index Name                            | Column(s)                    | Purpose                                    |
|---------------------------------------|------------------------------|--------------------------------------------|
| `idx_task_activities_task_id`         | `task_id`                    | Base lookup — all activities for a task     |
| `idx_task_activities_actor_id`        | `actor_id`                   | Lookup activities by who performed them     |
| `idx_task_activities_task_created`    | `(task_id, created_at DESC)` | **Primary query path** — paginated by recency |

### Constraints

- `task_id` and `actor_id` are **NOT NULL** with **ON DELETE CASCADE** — deleting a task or user removes all related activities
- `action` uses a PostgreSQL `ENUM` type (`task_activity_action`) for storage efficiency and validation
- `payload` defaults to `'{}'` (empty JSONB object), never NULL

### JSONB Payload Structure by Action

**`task_created`, `task_title_updated`, `task_description_updated`:**
```json
{}
```

**`task_status_changed`:**
```json
{ "from": "open", "to": "in_progress" }
```

**`task_priority_changed`:**
```json
{ "from": "medium", "to": "urgent" }
```

**`task_due_date_changed`:**
```json
{ "from": null, "to": "2026-04-10T00:00:00.000Z" }
```

**`task_assignee_added` / `task_assignee_removed`:**
```json
{
  "users": [
    { "user_id": "uuid-1", "full_name": "Grace Bui" },
    { "user_id": "uuid-2", "full_name": "John Doe" }
  ]
}
```

**`task_label_added` / `task_label_removed`:**
```json
{
  "labels": [
    { "label_id": 5, "label_name": "Frontend" },
    { "label_id": 3, "label_name": "Bug" }
  ]
}
```

**`task_moved`:**
```json
{ "from_column_id": 1, "to_column_id": 2, "position": 3 }
```

**`task_reordered`:**
```json
{ "position": 2 }
```

---

## 5. Service Logic

### Activity Creation Flow (Event-Driven)

```
1. Producer (TaskService) performs a mutation (e.g., update status)
2. Producer captures previous values BEFORE applying changes
3. Producer applies changes and saves to database
4. Producer compares previous vs new values for each field
5. For each changed field, producer emits an activity.task.* event:
   eventEmitter.emit('activity.task.status_changed', new TaskActivityEvent(...))
6. ActivityListener receives the event via @OnEvent decorator
7. Listener calls ActivityService.create()
8. Service persists the activity record to task_activities table
9. If any step in 6-8 fails, the error is logged but does NOT propagate
   back to the producer (fire-and-forget)
```

### Validation Rules

| Rule | Implementation |
|------|---------------|
| Task must exist | `findByTask()` checks `taskRepository.existsBy()` before querying activities |
| `taskId` must be valid UUID | `ParseUUIDPipe` in controller validates format |
| `page` must be >= 1 | `@Min(1)` validator in `ActivityQueryDto` |
| `limit` must be 1-100 | `@Min(1)` + `@Max(100)` validators |
| `action` must be valid enum | `@IsEnum(TaskActivityAction)` validator |
| Query params are strings | `@Transform` decorators parse string → int for page/limit |
| Only changed fields logged | `update()` compares each field before emitting |
| Duplicate-safe assignees | `addAssignees()` filters existing IDs before emitting |
| Due date comparison | Normalizes to `getTime()` to avoid format-dependent mismatches |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Task deleted while activities exist | All activities cascade-deleted via FK constraint |
| User deleted while activities exist | All activities by that actor cascade-deleted |
| `update()` sends same value as current | No activity emitted (change detection skips it) |
| Multiple fields changed in one `update()` | One activity per changed field |
| Multiple assignees added at once | Single activity record with `users` array |
| Empty assignee/label change (no diff) | No activity emitted |
| Event listener throws | Error logged, producer's HTTP response unaffected |
| Pagination beyond total pages | Returns `{ data: [], meta: { totalPages: N } }` |
| Filter by action with no matches | Returns `{ data: [], meta: { total: 0 } }` |

---

## 6. Security Considerations

### Authentication & Authorization

| Operation | Auth | Scope |
|-----------|------|-------|
| List task activities | JWT | Any authenticated user can view activities for any task |
| All task mutations | JWT | Auth required — `actorId` derived from JWT, never from request body |

All controller endpoints are decorated with `@UseGuards(JwtAuthGuard)`. The `actor_id` in activity records comes from the authenticated user context (`@CurrentUser('id')`) of the original HTTP request — it cannot be spoofed.

### Event Security

Events are emitted in-process via `EventEmitter2`. There is no external event bus, so events cannot be spoofed from outside the application.

### Input Validation

- `taskId` path parameter validated as UUID v4 via `ParseUUIDPipe`
- Query parameters validated via `class-validator` decorators with `class-transformer` for type coercion
- `action` filter validated against the `TaskActivityAction` enum — invalid values return 400

---

## 7. Performance Considerations

### Query Optimization

- **Primary query** (`GET /tasks/:taskId/activities`) uses the composite index `(task_id, created_at DESC)` which covers the WHERE and ORDER BY in a single index scan
- **Existence check** for task uses `existsBy()` — a lightweight query that doesn't load relations
- **`move()` method** uses a targeted `findOne({ select: ['id', 'column_id'] })` instead of loading the full task with relations, just to capture the previous column ID
- **Actor relation** is the only JOIN loaded on read — minimal overhead per query

### Write Optimization

- Activity records are flat with denormalized payload data — no JOINs on write
- Assignee/label changes emit a single event with an array payload instead of one event per user/label
- Event listeners are async and non-blocking — the producer's response is not delayed by activity creation
- Self-notification filtering happens in-memory before the database call

### Index Strategy

| Index | Covers | Estimated Impact |
|-------|--------|-----------------|
| `(task_id)` | Base WHERE clause | Required for FK lookups and cascading deletes |
| `(actor_id)` | "Who did this?" queries | Useful for admin/audit dashboards |
| `(task_id, created_at DESC)` | Primary query path + sort | Eliminates separate sort operation; covers pagination |

### JSONB Considerations

- JSONB is stored in a decomposed binary format, making key lookups efficient
- No GIN index on `payload` by default — add one only if you need to query by payload contents
- Payload is intentionally schemaless per activity type — validated at the application layer, not the database layer

### Scaling Thresholds

| Volume | Strategy |
|--------|----------|
| < 10K activities/task | Current offset pagination works well |
| 10K-100K activities/task | Switch to cursor-based pagination, consider TTL-based cleanup |
| > 100K activities/task | Partition table by `task_id`, add archival policy |

---

## 8. Future Improvements

### Near-Term

| Enhancement | Description |
|-------------|-------------|
| **WebSocket push** | Push new activities to connected clients in real-time for live timeline updates |
| **Cursor-based pagination** | Replace offset pagination with `created_at` cursor for consistent results during concurrent writes |
| **Activity aggregation** | "User A and 3 others changed status" instead of 4 separate records for rapid successive changes |
| **Bulk activity query** | Endpoint to fetch activities across multiple tasks (e.g., for a board-level activity feed) |

### Long-Term Scalability

| Concern | Strategy |
|---------|----------|
| **High write volume** | Move to async queue (Bull/BullMQ) for activity creation instead of synchronous event handling |
| **Cross-service** | Replace EventEmitter2 with an external message broker (Redis Pub/Sub, RabbitMQ) for microservice architecture |
| **Analytics** | Add a second listener that aggregates activity data for dashboards and reporting |
| **Full-text search** | Add GIN index on `payload` for searching activity content |
| **Retention policy** | Scheduled job to archive activities older than N days to cold storage |

---

## 9. File Structure

```
src/
├── modules/
│   └── activity/
│       ├── activity.entity.ts           # TypeORM entity + toJSON()
│       ├── activity.service.ts          # create() + findByTask()
│       ├── activity.controller.ts       # GET /tasks/:taskId/activities
│       ├── activity.listener.ts         # 12 @OnEvent handlers
│       ├── activity.module.ts           # NestJS module
│       ├── dto/
│       │   └── activity-query.dto.ts    # Pagination + action filter
│       └── events/
│           └── activity.events.ts       # ACTIVITY_EVENTS constants + TaskActivityAction enum + TaskActivityEvent class
├── migrations/
│   └── 1743552000000-create-task-activities.ts
```

---

## 10. Raw PostgreSQL Queries

### Schema Definition

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE task_activity_action AS ENUM (
    'task_created',
    'task_title_updated',
    'task_description_updated',
    'task_status_changed',
    'task_priority_changed',
    'task_due_date_changed',
    'task_assignee_added',
    'task_assignee_removed',
    'task_label_added',
    'task_label_removed',
    'task_moved',
    'task_reordered'
);

CREATE TABLE task_activities (
    id          UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID                   NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor_id    UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      task_activity_action   NOT NULL,
    payload     JSONB                  NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ            NOT NULL DEFAULT now()
);
```

### Index Creation

```sql
CREATE INDEX idx_task_activities_task_id ON task_activities (task_id);
CREATE INDEX idx_task_activities_actor_id ON task_activities (actor_id);
CREATE INDEX idx_task_activities_task_created ON task_activities (task_id, created_at DESC);
```

### Rollback (Migration Down)

```sql
DROP INDEX idx_task_activities_task_created;
DROP INDEX idx_task_activities_actor_id;
DROP INDEX idx_task_activities_task_id;
DROP TABLE task_activities;
DROP TYPE task_activity_action;
```

### Example Queries

**Insert a single activity:**

```sql
INSERT INTO task_activities (task_id, actor_id, action, payload)
VALUES (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    'task_status_changed',
    '{"from": "open", "to": "in_progress"}'
)
RETURNING *;
```

**Insert an assignee change activity (multiple users):**

```sql
INSERT INTO task_activities (task_id, actor_id, action, payload)
VALUES (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    'task_assignee_added',
    '{"users": [{"user_id": "uuid-1", "full_name": "Grace Bui"}, {"user_id": "uuid-2", "full_name": "John Doe"}]}'
)
RETURNING *;
```

**Fetch paginated activities for a task (newest first):**

```sql
SELECT
    a.id, a.action, a.payload, a.created_at,
    u.id AS actor_id, u.full_name AS actor_name,
    u.avatar_url AS actor_avatar
FROM task_activities a
JOIN users u ON u.id = a.actor_id
WHERE a.task_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
ORDER BY a.created_at DESC
LIMIT 20 OFFSET 0;
```

**Fetch activities filtered by action type:**

```sql
SELECT
    a.id, a.action, a.payload, a.created_at,
    u.id AS actor_id, u.full_name AS actor_name
FROM task_activities a
JOIN users u ON u.id = a.actor_id
WHERE a.task_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND a.action = 'task_status_changed'
ORDER BY a.created_at DESC
LIMIT 20 OFFSET 0;
```

**Count activities for a task:**

```sql
SELECT COUNT(*) AS activity_count
FROM task_activities
WHERE task_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

**Query activities by JSONB payload (e.g., find all status changes to "done"):**

```sql
SELECT *
FROM task_activities
WHERE action = 'task_status_changed'
  AND payload->>'to' = 'done'
ORDER BY created_at DESC;
```

**Find all activities by a specific actor across all tasks:**

```sql
SELECT
    a.id, a.task_id, a.action, a.payload, a.created_at,
    t.title AS task_title, t.ticket_id
FROM task_activities a
JOIN tasks t ON t.id = a.task_id
WHERE a.actor_id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
ORDER BY a.created_at DESC
LIMIT 50;
```

**Cleanup old activities (maintenance):**

```sql
DELETE FROM task_activities
WHERE created_at < now() - INTERVAL '365 days';
```
