# Notification System — Technical Documentation

**Feature:** Centralized Notification System
**Module:** `NotificationModule`
**Author:** Backend Engineering
**Date:** 2026-03-28
**Stack:** NestJS 11 / TypeORM / PostgreSQL / @nestjs/event-emitter

---

## 1. Overview

### Purpose

A centralized, event-driven notification system that allows any module in the application to trigger notifications without direct coupling. Notifications inform users about actions relevant to them — comments on their tasks, task assignments, mentions, and status changes.

### Problem It Solves

- **No visibility into activity:** Users had no way to know when someone commented on their task, assigned them work, or mentioned them
- **Tight coupling risk:** Without a centralized system, each module would need to implement its own notification logic, leading to duplication and inconsistency
- **Scalability:** A dedicated notification module provides a single point to extend with WebSockets, push notifications, or email delivery in the future

---

## 2. Architecture

### High-Level System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                        Producer Modules                          │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  CommentService  │  │   TaskService   │  │  Future Module  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                     │           │
│           ▼                    ▼                     ▼           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              EventEmitter2 (Event Bus)                    │   │
│  │                                                          │   │
│  │  notification.comment.created                            │   │
│  │  notification.comment.mentioned                          │   │
│  │  notification.task.assigned                              │   │
│  │  notification.task.updated                               │   │
│  └─────────────────────────┬────────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                     NotificationModule                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NotificationListener                                    │    │
│  │  @OnEvent('notification.comment.created')  → create()    │    │
│  │  @OnEvent('notification.comment.mentioned') → batch()    │    │
│  │  @OnEvent('notification.task.assigned')    → batch()     │    │
│  │  @OnEvent('notification.task.updated')     → batch()     │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NotificationService                                     │    │
│  │  create() / createBatch() / findByRecipient()            │    │
│  │  markAsRead() / markAllAsRead() / getUnreadCount()       │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         │                                        │
│                         ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NotificationController (REST API)                       │    │
│  │  GET    /notifications                                   │    │
│  │  GET    /notifications/unread-count                      │    │
│  │  PATCH  /notifications/read                              │    │
│  │  PATCH  /notifications/read-all                          │    │
│  │  DELETE /notifications/:id                               │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL — notifications table (JSONB payload)               │
└──────────────────────────────────────────────────────────────────┘
```

### Event-Driven vs Direct Service Call

The system supports **both** integration patterns:

| Pattern | When to Use | Example |
|---------|------------|---------|
| **Event-driven** (preferred) | Producer doesn't need to know about notifications; fire-and-forget | CommentService emits `notification.comment.created` after saving a comment |
| **Direct service call** | Consumer needs confirmation that the notification was created, or needs to handle errors | A scheduled job that creates digest notifications |

**Why event-driven is preferred:**
- **Loose coupling** — CommentService doesn't import NotificationModule
- **Non-blocking** — Notification creation failures don't break the primary operation
- **Extensible** — Adding a new listener (e.g., email, WebSocket push) requires zero changes to the producer

### Module Interaction

```
AppModule
├── EventEmitterModule.forRoot()   ← Global event bus
├── AuthModule                     ← JwtAuthGuard, CurrentUser
├── TaskModule                     ← Emits: task.assigned, task.updated
├── CommentModule                  ← Emits: comment.created, comment.mentioned
└── NotificationModule             ← Listens to all notification.* events
    ├── imports: [TypeOrmModule.forFeature([Notification])]
    ├── controllers: [NotificationController]
    ├── providers: [NotificationService, NotificationListener]
    └── exports: [NotificationService]
```

---

## 3. API Design

### Endpoints Summary

All endpoints require JWT authentication. Notifications are always scoped to the authenticated user.

| Method   | Endpoint                      | Description                          |
|----------|-------------------------------|--------------------------------------|
| `GET`    | `/notifications`              | List notifications (paginated)       |
| `GET`    | `/notifications/unread-count` | Get unread notification count        |
| `PATCH`  | `/notifications/read`         | Mark specific notifications as read  |
| `PATCH`  | `/notifications/read-all`     | Mark all notifications as read       |
| `DELETE` | `/notifications/:id`          | Delete a notification                |

### 3.1 List Notifications

**`GET /notifications`**

Query Parameters:

| Param    | Type    | Default | Description                                      |
|----------|---------|---------|--------------------------------------------------|
| `page`   | int     | `1`     | Page number (1-based)                             |
| `limit`  | int     | `20`    | Items per page (max: 100)                         |
| `is_read`| boolean | —       | Filter: `true` = read only, `false` = unread only |
| `type`   | enum    | —       | Filter by notification type                       |

Example: `GET /notifications?is_read=false&limit=10`

Response `200 OK`:
```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "type": "comment_created",
      "entity_type": "task",
      "entity_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "payload": {
        "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "task_title": "Implement login page",
        "ticket_id": "KAN-1",
        "comment_id": "d4e5f6a7-b890-1234-cdef-567890abcdef",
        "comment_preview": "This looks good, but we need to fix the validation...",
        "author": {
          "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
          "full_name": "Jane Smith",
          "avatar_url": "https://example.com/avatar.jpg"
        }
      },
      "is_read": false,
      "read_at": null,
      "actor": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "full_name": "Jane Smith",
        "email": "jane@example.com",
        "avatar_url": "https://example.com/avatar.jpg"
      },
      "created_at": "2026-03-28T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5
  }
}
```

### 3.2 Get Unread Count

**`GET /notifications/unread-count`**

Response `200 OK`:
```json
{
  "count": 7
}
```

### 3.3 Mark Specific Notifications as Read

**`PATCH /notifications/read`**

Request Body:
```json
{
  "ids": [
    "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  ]
}
```

Response `200 OK`:
```json
{
  "updated": 2
}
```

### 3.4 Mark All as Read

**`PATCH /notifications/read-all`**

Response `200 OK`:
```json
{
  "updated": 7
}
```

### 3.5 Delete Notification

**`DELETE /notifications/:id`**

Response: `204 No Content`

---

## 4. Database Design

### Table: `notifications`

| Column         | Type               | Nullable | Default              | Description                                |
|---------------|--------------------|----------|----------------------|--------------------------------------------|
| `id`          | `UUID`             | NO       | `gen_random_uuid()`  | Primary key                                |
| `type`        | `notification_type`| NO       | —                    | Enum: comment_created, comment_mentioned, task_assigned, task_updated |
| `recipient_id`| `UUID`             | NO       | —                    | FK to `users(id)` — who receives this      |
| `actor_id`    | `UUID`             | NO       | —                    | FK to `users(id)` — who triggered this     |
| `entity_type` | `VARCHAR(50)`      | NO       | —                    | Polymorphic type: 'task', 'comment', etc.  |
| `entity_id`   | `UUID`             | NO       | —                    | ID of the related entity                   |
| `payload`     | `JSONB`            | NO       | `'{}'`               | Dynamic context-specific data              |
| `is_read`     | `BOOLEAN`          | NO       | `false`              | Read/unread status                         |
| `read_at`     | `TIMESTAMPTZ`      | YES      | —                    | When the notification was read             |
| `created_at`  | `TIMESTAMPTZ`      | NO       | `now()`              | Creation timestamp                         |

### Entity Relationship Diagram

```
┌──────────────┐       ┌────────────────────┐
│    users     │       │   notifications    │
├──────────────┤       ├────────────────────┤
│ id (PK)      │◄──┬───│ recipient_id (FK)  │
│ full_name    │   │   │ actor_id (FK)      │──┐
│ email        │   │   │ id (PK)            │  │
│ avatar_url   │   │   │ type               │  │
│ ...          │   │   │ entity_type        │  │
└──────────────┘   │   │ entity_id          │  │
                   │   │ payload (JSONB)     │  │
                   │   │ is_read            │  │
                   │   │ read_at            │  │
                   │   │ created_at         │  │
                   │   └────────────────────┘  │
                   │                            │
                   └────────────────────────────┘
                     (both FKs reference users)
```

### JSONB Payload Structure by Type

The `payload` column stores context-specific data as JSONB. Each notification type has a defined payload shape:

**`comment_created`:**
```json
{
  "task_id": "uuid",
  "task_title": "Implement login page",
  "ticket_id": "KAN-1",
  "comment_id": "uuid",
  "comment_preview": "First 120 chars of plain text...",
  "author": {
    "id": "uuid",
    "full_name": "Jane Smith",
    "avatar_url": "https://example.com/avatar.jpg"
  }
}
```

**`comment_mentioned`:**
```json
{
  "task_id": "uuid",
  "task_title": "Implement login page",
  "ticket_id": "KAN-1",
  "comment_id": "uuid",
  "comment_preview": "Hey @john, can you review..."
}
```

**`task_assigned`:**
```json
{
  "task_id": "uuid",
  "task_title": "Implement login page",
  "ticket_id": "KAN-1"
}
```

**`task_updated`:**
```json
{
  "task_id": "uuid",
  "task_title": "Implement login page",
  "ticket_id": "KAN-1",
  "changes": {
    "status": { "from": "open", "to": "in_progress" }
  }
}
```

### Indexes

| Index Name                              | Column(s)                                  | Purpose                                     |
|-----------------------------------------|--------------------------------------------|---------------------------------------------|
| `idx_notifications_recipient_id`        | `recipient_id`                             | Base index for user's notifications         |
| `idx_notifications_actor_id`            | `actor_id`                                 | Lookup notifications by who triggered them  |
| `idx_notifications_type`                | `type`                                     | Filter by notification type                 |
| `idx_notifications_entity`              | `entity_id`                                | Find all notifications for a specific entity|
| `idx_notifications_recipient_unread`    | `(recipient_id, is_read, created_at DESC)` | **Primary query path** — unread notifications for a user, newest first |

The composite index `idx_notifications_recipient_unread` is the most critical — it covers the most common query pattern (fetching a user's unread notifications sorted by recency) in a single index scan.

### Constraints

- `recipient_id` and `actor_id` are **NOT NULL** with **ON DELETE CASCADE** — deleting a user removes all their notifications
- `type` uses a PostgreSQL `ENUM` type for storage efficiency and validation
- `payload` defaults to `'{}'` (empty JSONB object), never NULL

---

## 5. Service Logic

### Notification Creation Flow (Event-Driven)

```
1. Producer module performs action (e.g., CommentService.create())
2. Producer emits event via EventEmitter2:
   eventEmitter.emit('notification.comment.created', new CommentCreatedEvent(...))
3. NotificationListener receives the event via @OnEvent decorator
4. Listener calls NotificationService.create() or .createBatch()
5. Service filters out self-notifications (actor === recipient)
6. Service persists notification(s) to database
7. If any step fails, the error is logged but does NOT propagate
   back to the producer (fire-and-forget)
```

### Self-Notification Prevention

The service automatically skips creating notifications where `recipient_id === actor_id`. This means:
- Commenting on your own task doesn't notify you
- Assigning a task to yourself doesn't notify you
- Producers don't need to check for this — it's handled centrally

### Batch Creation

For events with multiple recipients (mentions, assignments), `createBatch()` filters self-notifications and inserts all valid notifications in a single database operation.

### Read Status Management

| Operation | Behavior |
|-----------|----------|
| `markAsRead(ids)` | Updates only unread notifications owned by the user; returns count of actually updated rows |
| `markAllAsRead()` | Bulk updates all unread notifications for the user; uses a single `UPDATE ... WHERE` |
| Read timestamp | `read_at` is set to `now()` when marked as read, stays `null` while unread |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Actor === Recipient | Notification silently skipped (no self-notifications) |
| Task/user deleted while notifications exist | All related notifications cascade-deleted |
| Mark already-read notification as read | No-op (WHERE clause filters `is_read = false`) |
| Event listener throws | Error logged, producer unaffected |
| Empty `ids` array in markAsRead | Rejected by DTO validation (`400 Bad Request`) |
| Delete another user's notification | Returns `404 Not Found` (scoped to recipient) |

---

## 6. Security Considerations

### Authentication & Authorization

| Operation | Auth | Scope |
|-----------|------|-------|
| List notifications | JWT | Own notifications only (filtered by `recipient_id = currentUser.id`) |
| Get unread count | JWT | Own count only |
| Mark as read | JWT | Only updates own unread notifications |
| Mark all as read | JWT | Only updates own notifications |
| Delete notification | JWT | Only deletes own notifications (404 if not owner) |

All controller endpoints are decorated with `@UseGuards(JwtAuthGuard)` at the class level. The `recipient_id` is always derived from the JWT — never from request parameters — preventing users from reading or modifying other users' notifications.

### Event Security

Events are emitted in-process via `EventEmitter2`. There is no external event bus, so events cannot be spoofed from outside the application. The `actor_id` in events comes from the authenticated user context of the original HTTP request.

---

## 7. Performance Considerations

### Query Optimization

- **Primary query** (`GET /notifications`) uses the composite index `(recipient_id, is_read, created_at DESC)` which covers the WHERE, filter, and ORDER BY in a single index scan
- **Unread count** uses `COUNT(*)` with the same composite index — no table scan needed
- **Batch mark-as-read** uses a single `UPDATE ... WHERE id IN (...)` instead of individual updates
- **Mark all as read** uses a single `UPDATE ... WHERE recipient_id = ? AND is_read = false`
- **Actor relation** is the only JOIN loaded — minimal overhead per query

### Write Optimization

- `createBatch()` uses TypeORM's bulk `save()` which generates a single `INSERT ... VALUES (...)` statement
- Self-notification filtering happens in-memory before the database call
- Event listeners are async and non-blocking — the producer's response is not delayed by notification creation

### JSONB Considerations

- JSONB is stored in a decomposed binary format, making key lookups efficient
- No GIN index on `payload` by default — add one only if you need to query by payload contents (e.g., "find all notifications for task X")
- Payload is intentionally schemaless per notification type — validated at the application layer, not the database layer

### Scaling Thresholds

| Volume | Strategy |
|--------|----------|
| < 10K notifications/user | Current offset pagination works well |
| 10K–100K notifications/user | Add cursor-based pagination, consider TTL-based cleanup |
| > 100K notifications/user | Partition table by `recipient_id`, add archival policy |
| Real-time delivery needed | Add WebSocket gateway (see Future Improvements) |

---

## 8. Future Improvements

### Near-Term

| Enhancement | Description |
|-------------|-------------|
| **WebSocket push** | Add `@nestjs/websockets` gateway to push notifications to connected clients in real-time via `notification.created` events |
| **Email notifications** | Add an email listener alongside the database listener, with user preference controls |
| **Notification preferences** | `notification_preferences` table per user to opt out of specific types |
| **TTL / auto-cleanup** | Scheduled job to archive or delete notifications older than N days |
| **Aggregate notifications** | "John and 3 others commented on your task" instead of 4 separate notifications |

### Long-Term Scalability

| Concern | Strategy |
|---------|----------|
| **High write volume** | Move to async queue (Bull/BullMQ) for notification creation instead of synchronous event handling |
| **Cross-service** | Replace EventEmitter2 with an external message broker (Redis Pub/Sub, RabbitMQ) for microservice architecture |
| **Mobile push** | Add FCM/APNs integration triggered by the same event listeners |
| **Read receipts at scale** | Use Redis bitmap for unread counts instead of `COUNT(*)` queries |
| **Full-text search** | Add GIN index on `payload` for searching notification content |

---

## 9. How to Emit Notifications from Other Modules

### Step 1: Inject EventEmitter2

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class YourService {
  constructor(private readonly eventEmitter: EventEmitter2) {}
}
```

No module imports needed — `EventEmitterModule.forRoot()` is registered globally in `AppModule`.

### Step 2: Emit an Event

```typescript
import {
  NOTIFICATION_EVENTS,
  TaskAssignedEvent,
} from '../notification/events/notification.events';

// Inside your service method:
this.eventEmitter.emit(
  NOTIFICATION_EVENTS.TASK_ASSIGNED,
  new TaskAssignedEvent(
    currentUserId,          // actor_id
    task.id,                // entity_id
    newAssigneeIds,         // recipient_ids (array)
    {
      task_id: task.id,
      task_title: task.title,
      ticket_id: task.ticket_id,
    },
  ),
);
```

### Step 3: Add a New Notification Type (if needed)

1. Add the type to `NotificationType` enum in `notification.entity.ts`
2. Add the event name to `NOTIFICATION_EVENTS` in `events/notification.events.ts`
3. Create a typed event class
4. Add an `@OnEvent` handler in `notification.listener.ts`
5. Add the new enum value to the PostgreSQL `notification_type` type via migration

---

## 10. File Structure

```
src/
├── modules/
│   └── notification/
│       ├── notification.entity.ts           # TypeORM entity + NotificationType enum
│       ├── notification.service.ts          # CRUD + batch operations
│       ├── notification.controller.ts       # REST API (all JWT-protected)
│       ├── notification.listener.ts         # @OnEvent handlers
│       ├── notification.module.ts           # NestJS module
│       ├── dto/
│       │   ├── notification-query.dto.ts    # Pagination + filters
│       │   └── mark-notifications-read.dto.ts # Batch mark-as-read
│       └── events/
│           └── notification.events.ts       # Event constants + typed event classes
├── migrations/
│   └── 1743120000000-create-notifications.ts # Schema migration
```

---

## 11. Raw PostgreSQL Queries

### Schema Definition

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE notification_type AS ENUM (
    'comment_created',
    'comment_mentioned',
    'task_assigned',
    'task_updated'
);

CREATE TABLE notifications (
    id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    type          notification_type NOT NULL,
    recipient_id  UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id      UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type   VARCHAR(50)       NOT NULL,
    entity_id     UUID              NOT NULL,
    payload       JSONB             NOT NULL DEFAULT '{}',
    is_read       BOOLEAN           NOT NULL DEFAULT false,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ       NOT NULL DEFAULT now()
);
```

### Index Creation

```sql
-- Single-column indexes
CREATE INDEX idx_notifications_recipient_id ON notifications (recipient_id);
CREATE INDEX idx_notifications_actor_id ON notifications (actor_id);
CREATE INDEX idx_notifications_type ON notifications (type);
CREATE INDEX idx_notifications_entity ON notifications (entity_id);

-- Composite index for primary query pattern
CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id, is_read, created_at DESC);
```

### Rollback (Migration Down)

```sql
DROP INDEX idx_notifications_recipient_unread;
DROP INDEX idx_notifications_entity;
DROP INDEX idx_notifications_type;
DROP INDEX idx_notifications_actor_id;
DROP INDEX idx_notifications_recipient_id;
DROP TABLE notifications;
DROP TYPE notification_type;
```

### Example Queries

**Insert a single notification:**
```sql
INSERT INTO notifications (type, recipient_id, actor_id, entity_type, entity_id, payload)
VALUES (
    'comment_created',
    'c3d4e5f6-a7b8-9012-cdef-0123456789ab',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    'task',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    '{"task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "task_title": "Implement login", "ticket_id": "KAN-1", "comment_id": "d4e5f6a7-b890-1234-cdef-567890abcdef", "comment_preview": "This looks good..."}'
)
RETURNING *;
```

**Batch insert notifications (multi-recipient):**
```sql
INSERT INTO notifications (type, recipient_id, actor_id, entity_type, entity_id, payload)
VALUES
    ('task_assigned', 'user-1-uuid', 'actor-uuid', 'task', 'task-uuid', '{"task_id": "task-uuid", "task_title": "Login page", "ticket_id": "KAN-1"}'),
    ('task_assigned', 'user-2-uuid', 'actor-uuid', 'task', 'task-uuid', '{"task_id": "task-uuid", "task_title": "Login page", "ticket_id": "KAN-1"}');
```

**Fetch paginated unread notifications for a user (newest first):**
```sql
SELECT
    n.id, n.type, n.entity_type, n.entity_id, n.payload,
    n.is_read, n.read_at, n.created_at,
    u.id AS actor_id, u.full_name AS actor_name,
    u.email AS actor_email, u.avatar_url AS actor_avatar
FROM notifications n
JOIN users u ON u.id = n.actor_id
WHERE n.recipient_id = 'c3d4e5f6-a7b8-9012-cdef-0123456789ab'
  AND n.is_read = false
ORDER BY n.created_at DESC
LIMIT 20 OFFSET 0;
```

**Get unread count:**
```sql
SELECT COUNT(*) AS unread_count
FROM notifications
WHERE recipient_id = 'c3d4e5f6-a7b8-9012-cdef-0123456789ab'
  AND is_read = false;
```

**Mark specific notifications as read:**
```sql
UPDATE notifications
SET is_read = true,
    read_at = now()
WHERE id IN ('notif-uuid-1', 'notif-uuid-2')
  AND recipient_id = 'c3d4e5f6-a7b8-9012-cdef-0123456789ab'
  AND is_read = false;
```

**Mark all as read for a user:**
```sql
UPDATE notifications
SET is_read = true,
    read_at = now()
WHERE recipient_id = 'c3d4e5f6-a7b8-9012-cdef-0123456789ab'
  AND is_read = false;
```

**Delete a notification (scoped to owner):**
```sql
DELETE FROM notifications
WHERE id = 'notif-uuid'
  AND recipient_id = 'c3d4e5f6-a7b8-9012-cdef-0123456789ab';
```

**Query notifications by JSONB payload (e.g., all notifications for a specific task):**
```sql
SELECT *
FROM notifications
WHERE payload->>'task_id' = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
ORDER BY created_at DESC;
```

**Cleanup old read notifications (maintenance):**
```sql
DELETE FROM notifications
WHERE is_read = true
  AND created_at < now() - INTERVAL '90 days';
```
