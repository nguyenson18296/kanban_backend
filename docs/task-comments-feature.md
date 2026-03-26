# Task Comments System — Technical Documentation

**Feature:** Task Comments
**Module:** `CommentModule`
**Author:** Backend Engineering
**Date:** 2026-03-26
**Stack:** NestJS 11 / TypeORM / PostgreSQL

---

## 1. Overview

### Purpose

The Task Comments system enables users to leave comments on individual tasks within the Kanban board. Each task can have multiple comments displayed as a flat, chronologically ordered list, supporting rich text (HTML) content with server-side sanitization.

### Problem It Solves

Prior to this feature, collaboration on tasks was limited to the task description field. Teams had no way to:

- Discuss implementation details, blockers, or decisions directly on a task
- Track the history of conversations tied to specific work items
- Distinguish between the original task specification and ongoing discussion

The comment system provides a dedicated, auditable communication channel scoped to each task.

---

## 2. Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────┐
│                     Client (Frontend)                   │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
         JWT Bearer Token           HTTP Request
               │                          │
               ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│  CommentController                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ POST   /tasks/:taskId/comments     [Auth Required] │  │
│  │ GET    /tasks/:taskId/comments     [Public]        │  │
│  │ PATCH  /comments/:id              [Auth Required]  │  │
│  │ DELETE /comments/:id              [Auth Required]  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│  DTO Validation Layer (class-validator + class-transformer) │
│  ┌────────────────────────────────────────────────────┐  │
│  │ CreateCommentDto  — @Transform → sanitize(content) │  │
│  │ UpdateCommentDto  — @Transform → sanitize(content) │  │
│  │ CommentQueryDto   — page, limit, sort              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│  CommentService                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ create()      — validate task, persist, return     │  │
│  │ findByTask()  — paginated query with author join   │  │
│  │ update()      — ownership check, set is_edited     │  │
│  │ remove()      — ownership check, delete            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│  PostgreSQL — task_comments table                        │
│  FK → tasks(id)   ON DELETE CASCADE                      │
│  FK → users(id)   ON DELETE CASCADE                      │
└──────────────────────────────────────────────────────────┘
```

### Module Integration

```
AppModule
├── AuthModule          ← provides JwtAuthGuard, CurrentUser decorator
├── TaskModule          ← provides Task entity (referenced by Comment FK)
├── UserModule          ← provides User entity (referenced by Comment FK)
└── CommentModule       ← NEW
    ├── imports: [TypeOrmModule.forFeature([Comment, Task])]
    ├── controllers: [CommentController]
    ├── providers: [CommentService]
    └── exports: [CommentService]
```

The `CommentModule` depends on `Task` and `User` entities but does **not** import `TaskModule` or `UserModule` directly — it accesses them via `TypeOrmModule.forFeature()` for repository injection. Authentication is handled by importing guards/decorators from `AuthModule`.

---

## 3. API Design

### Endpoints Summary

| Method   | Endpoint                        | Auth     | Description                     |
|----------|---------------------------------|----------|---------------------------------|
| `POST`   | `/tasks/:taskId/comments`       | Required | Create a comment on a task      |
| `GET`    | `/tasks/:taskId/comments`       | Public   | List comments (paginated)       |
| `PATCH`  | `/comments/:id`                 | Required | Update own comment              |
| `DELETE` | `/comments/:id`                 | Required | Delete own comment              |

### 3.1 Create Comment

**`POST /tasks/:taskId/comments`**

Headers:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

Request Body:
```json
{
  "content": "<p>This looks good, but we need to fix the <strong>validation</strong> logic.</p>"
}
```

Response `201 Created`:
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "content": "<p>This looks good, but we need to fix the <strong>validation</strong> logic.</p>",
  "is_edited": false,
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "author": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "full_name": "John Doe",
    "email": "john@example.com"
  },
  "created_at": "2026-03-26T10:30:00.000Z",
  "updated_at": "2026-03-26T10:30:00.000Z"
}
```

Error Responses:
- `401 Unauthorized` — Missing or invalid JWT
- `404 Not Found` — Task does not exist

### 3.2 List Comments

**`GET /tasks/:taskId/comments`**

Query Parameters:

| Param   | Type   | Default | Description                        |
|---------|--------|---------|------------------------------------|
| `page`  | int    | `1`     | Page number (1-based)              |
| `limit` | int    | `20`    | Items per page (max: 100)          |
| `sort`  | string | `DESC`  | Sort by `created_at` (`ASC`/`DESC`) |

Example: `GET /tasks/a1b2c3d4-.../comments?page=1&limit=10&sort=DESC`

Response `200 OK`:
```json
{
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "content": "<p>Updated the validation logic as discussed.</p>",
      "is_edited": true,
      "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "author": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "full_name": "John Doe",
        "email": "john@example.com"
      },
      "created_at": "2026-03-26T10:30:00.000Z",
      "updated_at": "2026-03-26T11:15:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

Error Responses:
- `404 Not Found` — Task does not exist

### 3.3 Update Comment

**`PATCH /comments/:id`**

Headers:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

Request Body:
```json
{
  "content": "<p>Actually, I think we should <em>also</em> handle the edge case for empty input.</p>"
}
```

Response `200 OK`:
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "content": "<p>Actually, I think we should <em>also</em> handle the edge case for empty input.</p>",
  "is_edited": true,
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "author": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "full_name": "John Doe",
    "email": "john@example.com"
  },
  "created_at": "2026-03-26T10:30:00.000Z",
  "updated_at": "2026-03-26T11:45:00.000Z"
}
```

Error Responses:
- `401 Unauthorized` — Missing or invalid JWT
- `403 Forbidden` — Authenticated user is not the comment author
- `404 Not Found` — Comment does not exist

### 3.4 Delete Comment

**`DELETE /comments/:id`**

Headers:
```
Authorization: Bearer <jwt_token>
```

Response: `204 No Content`

Error Responses:
- `401 Unauthorized` — Missing or invalid JWT
- `403 Forbidden` — Authenticated user is not the comment author
- `404 Not Found` — Comment does not exist

---

## 4. Database Design

### Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │  task_comments    │       │    tasks     │
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)      │◄──────│ author_id (FK)   │       │ id (PK)      │
│ full_name    │       │ id (PK)          │──────►│ title        │
│ email        │       │ content          │       │ status       │
│ ...          │       │ is_edited        │       │ ...          │
└──────────────┘       │ task_id (FK)     │       └──────────────┘
                       │ created_at       │
                       │ updated_at       │
                       └──────────────────┘
```

### Table: `task_comments`

| Column       | Type          | Nullable | Default              | Description                       |
|-------------|---------------|----------|----------------------|-----------------------------------|
| `id`        | `UUID`        | NO       | `gen_random_uuid()`  | Primary key                       |
| `content`   | `TEXT`        | NO       | —                    | Sanitized HTML content            |
| `is_edited` | `BOOLEAN`     | NO       | `false`              | Set to `true` on first update     |
| `task_id`   | `UUID`        | NO       | —                    | FK to `tasks(id)` ON DELETE CASCADE |
| `author_id` | `UUID`        | NO       | —                    | FK to `users(id)` ON DELETE CASCADE |
| `created_at`| `TIMESTAMPTZ` | NO       | `now()`              | Immutable creation timestamp      |
| `updated_at`| `TIMESTAMPTZ` | NO       | `now()`              | Auto-updated by TypeORM           |

### Relationships

| Relationship            | Type       | Cascade Behavior                              |
|------------------------|------------|-----------------------------------------------|
| `task_comments → tasks` | Many-to-One | **ON DELETE CASCADE** — deleting a task removes all its comments |
| `task_comments → users` | Many-to-One | **ON DELETE CASCADE** — deleting a user removes all their comments |

### Indexes

| Index Name                      | Column(s)   | Purpose                                  |
|---------------------------------|-------------|------------------------------------------|
| `idx_task_comments_task_id`     | `task_id`   | Fast lookup of comments by task           |
| `idx_task_comments_author_id`   | `author_id` | Fast lookup of comments by author         |

### Constraints

- `task_id` is **NOT NULL** — every comment must belong to a task
- `author_id` is **NOT NULL** — every comment must have an author
- `content` is **NOT NULL** — empty comments are rejected at the DTO validation layer

---

## 5. Service Logic

### Business Logic Flow

#### Create Comment
```
1. Validate task exists (ensureTaskExists)     → 404 if not found
2. HTML content already sanitized by DTO @Transform
3. Create comment entity with task_id + author_id from JWT
4. Persist to database
5. Re-fetch with author relation joined
6. Return comment
```

#### List Comments (Paginated)
```
1. Validate task exists                        → 404 if not found
2. Query with:
   - WHERE task_id = :taskId
   - JOIN author relation
   - ORDER BY created_at (ASC or DESC)
   - OFFSET/LIMIT pagination
3. Return { data, meta: { page, limit, total, totalPages } }
```

#### Update Comment
```
1. Find comment by ID                          → 404 if not found
2. Check comment.author_id === currentUser.id  → 403 if mismatch
3. Update content (already sanitized by DTO)
4. Set is_edited = true
5. Persist (updated_at auto-updated by TypeORM)
6. Re-fetch and return
```

#### Delete Comment
```
1. Find comment by ID                          → 404 if not found
2. Check comment.author_id === currentUser.id  → 403 if mismatch
3. Remove from database
4. Return 204 No Content
```

### Validation Rules

| Rule                          | Layer        | Enforcement                              |
|-------------------------------|-------------|------------------------------------------|
| Content must be a string       | DTO         | `@IsString()`                            |
| Content cannot be empty        | DTO         | `@IsNotEmpty()`                          |
| HTML content is sanitized      | DTO         | `@Transform → sanitize()` via `sanitize-html` |
| Task must exist               | Service      | `ensureTaskExists()` → `404`             |
| Only author can edit/delete    | Service      | `ensureOwnership()` → `403`             |
| Page must be >= 1             | DTO          | `@Min(1)`                                |
| Limit must be 1–100           | DTO          | `@Min(1)` + `@Max(100)`                 |
| Sort must be ASC or DESC      | DTO          | `@IsEnum(CommentSortOrder)`             |
| IDs must be valid UUIDs        | Controller  | `ParseUUIDPipe`                          |

### Edge Cases

| Scenario                              | Behavior                                           |
|---------------------------------------|-----------------------------------------------------|
| Comment on non-existent task          | `404 Not Found`                                     |
| Update/delete another user's comment  | `403 Forbidden`                                     |
| Task deleted while comments exist      | All comments cascade-deleted at the DB level        |
| User deleted while comments exist      | All their comments cascade-deleted at the DB level  |
| Malicious HTML/script tags in content  | Stripped by `sanitize-html` before persistence       |
| Empty content after sanitization       | Rejected by `@IsNotEmpty()` (sanitize runs first via `@Transform`) |
| Page exceeds total pages               | Returns `{ data: [], meta: { ... } }` (empty page) |

---

## 6. Security Considerations

### Authentication & Authorization

| Operation        | Authentication | Authorization                          |
|-----------------|----------------|----------------------------------------|
| Create comment   | JWT required   | Any authenticated user                 |
| List comments    | None           | Public (read-only)                     |
| Update comment   | JWT required   | Comment author only (`ensureOwnership`) |
| Delete comment   | JWT required   | Comment author only (`ensureOwnership`) |

Authentication is enforced via `@UseGuards(JwtAuthGuard)` at the controller level. The current user's ID is extracted from the JWT payload using `@CurrentUser('id')` — it is never taken from the request body, preventing impersonation.

### Input Validation & XSS Prevention

HTML content is sanitized at the DTO layer using [`sanitize-html`](https://www.npmjs.com/package/sanitize-html) before it reaches the service or database.

**Allowed HTML tags:**
```
p, br, b, i, em, strong, a, ul, ol, li, blockquote, code, pre, h1, h2, h3, span
```

**Allowed attributes:**
- `<a>` — `href`, `target`, `rel`
- `<span>` — `class`

**Security transformations:**
- All `<a>` tags are forced to have `target="_blank"` and `rel="noopener noreferrer"`
- Only `http`, `https`, and `mailto` URL schemes are allowed (blocks `javascript:` URIs)
- All tags and attributes not in the allowlist are stripped (not escaped — completely removed)

**What gets blocked:**
```html
<!-- Input -->
<script>alert('xss')</script>
<img src=x onerror=alert('xss')>
<a href="javascript:alert('xss')">click</a>

<!-- Output after sanitization -->

<a href target="_blank" rel="noopener noreferrer">click</a>
```

---

## 7. Performance Considerations

### Query Optimization

- **List comments** uses `findAndCount` which executes two queries — one `SELECT` for the paginated rows and a separate `SELECT COUNT(*)` for the total — but both are simple indexed lookups, avoiding N+1 issues
- **Author relation** is joined eagerly only when returning comments to the client — internal lookups (`findOneById`) also join author to avoid a second round-trip
- **Task existence** check uses `existsBy()` which translates to `SELECT 1 ... LIMIT 1` — cheaper than loading the full task entity

### Index Strategy

| Index                            | Supports                                          |
|----------------------------------|---------------------------------------------------|
| `idx_task_comments_task_id`      | `WHERE task_id = ?` (list comments for a task)    |
| `idx_task_comments_author_id`    | Future: "my comments" queries, admin lookups      |
| PK index on `id`                 | Single comment lookups (update, delete)            |

The `task_id` index is the most critical — it directly supports the primary query pattern (fetching comments for a given task). Combined with `ORDER BY created_at` and `LIMIT/OFFSET`, PostgreSQL will efficiently use an index scan + sort for typical page sizes.

### Pagination

Offset-based pagination is used with a configurable limit (default: 20, max: 100). This is appropriate for comment lists where:
- Total counts are useful for UI (progress bars, "showing X of Y")
- Users typically browse sequentially (page 1, 2, 3...)
- Comment volumes per task are generally in the hundreds, not millions

---

## 8. Future Improvements

### Near-Term Enhancements

| Enhancement                  | Description                                                  |
|-----------------------------|--------------------------------------------------------------|
| **@mentions**                | Parse `@username` in content, store in a `comment_mentions` join table, trigger notifications |
| **Activity tracking**        | Emit events (`comment.created`, `comment.updated`, `comment.deleted`) via NestJS `EventEmitter2` for an activity feed |
| **Admin delete**             | Allow project admins to delete any comment, not just their own |
| **Soft delete**              | Add `deleted_at` column instead of hard delete, for audit trails |
| **Comment count on task**    | Add a `comment_count` virtual/computed field to the Task response for UI badges |

### Scalability Considerations

| Concern                      | Mitigation Strategy                                          |
|-----------------------------|--------------------------------------------------------------|
| **High-volume tasks**        | Switch from offset to cursor-based pagination (`WHERE created_at < :cursor`) to avoid `OFFSET` degradation |
| **Real-time updates**        | Add WebSocket gateway (`@nestjs/websockets`) to push new comments to connected clients |
| **Full-text search**         | Add a GIN index on `content` using `tsvector` for searching across comments |
| **Rate limiting**            | Apply `@nestjs/throttler` to the create endpoint to prevent spam |
| **Edit history**             | Store comment revisions in a `comment_revisions` table instead of overwriting content |

---

## 9. File Structure

```
src/
├── common/
│   └── utils/
│       └── sanitize-html.util.ts          # Shared HTML sanitizer
├── modules/
│   └── comment/
│       ├── comment.entity.ts              # TypeORM entity
│       ├── comment.service.ts             # Business logic
│       ├── comment.controller.ts          # REST endpoints
│       ├── comment.module.ts              # NestJS module
│       └── dto/
│           ├── create-comment.dto.ts      # Create validation + sanitization
│           ├── update-comment.dto.ts      # Update validation + sanitization
│           └── comment-query.dto.ts       # Pagination & sort params
├── migrations/
│   └── 1742860800000-create-task-comments.ts  # Schema migration
```

---

## 10. Raw PostgreSQL Queries

### Schema Definition

```sql
CREATE TABLE task_comments (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    content     TEXT          NOT NULL,
    is_edited   BOOLEAN       NOT NULL DEFAULT false,
    task_id     UUID          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

### Index Creation

```sql
CREATE INDEX idx_task_comments_task_id ON task_comments (task_id);
CREATE INDEX idx_task_comments_author_id ON task_comments (author_id);
```

### Rollback (Migration Down)

```sql
DROP INDEX idx_task_comments_author_id;
DROP INDEX idx_task_comments_task_id;
DROP TABLE task_comments;
```

### Example Queries

**Insert a comment:**
```sql
INSERT INTO task_comments (content, task_id, author_id)
VALUES (
    '<p>This looks good, but we need to fix the <strong>validation</strong>.</p>',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901'
)
RETURNING *;
```

**Fetch paginated comments for a task (newest first):**
```sql
SELECT
    c.id,
    c.content,
    c.is_edited,
    c.task_id,
    c.created_at,
    c.updated_at,
    u.id       AS author_id,
    u.full_name AS author_name,
    u.email    AS author_email
FROM task_comments c
JOIN users u ON u.id = c.author_id
WHERE c.task_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
ORDER BY c.created_at DESC
LIMIT 20 OFFSET 0;
```

**Count total comments for pagination metadata:**
```sql
SELECT COUNT(*) AS total
FROM task_comments
WHERE task_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

**Update a comment (mark as edited):**
```sql
UPDATE task_comments
SET content    = '<p>Updated content here.</p>',
    is_edited  = true,
    updated_at = now()
WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
```

**Delete a comment:**
```sql
DELETE FROM task_comments
WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
```

**Get comment count per task (for UI badges):**
```sql
SELECT task_id, COUNT(*) AS comment_count
FROM task_comments
GROUP BY task_id;
```

**Find all comments by a specific user:**
```sql
SELECT c.*, t.title AS task_title, t.ticket_id
FROM task_comments c
JOIN tasks t ON t.id = c.task_id
WHERE c.author_id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
ORDER BY c.created_at DESC;
```
