# Task Subscriptions — Frontend Integration Guide (KAN-78)

Integration guide for the **task subscription (watcher)** feature. Written for a
**Vite + TypeScript + React (TanStack Query v5)** frontend.

- Backend base URL: `http://localhost:1996/api` (global `/api` prefix; port `1996`).
- Swagger reference (dev only): `http://localhost:1996/api/docs`.
- All subscription endpoints require a **Bearer JWT**: `Authorization: Bearer <access_token>`.

---

## 1. What this feature does

A user becomes a **subscriber** of a task and then receives notifications for
future activity on it (new comments, status changes, assignments).

**Users are subscribed automatically — no frontend call needed — when they:**

| Trigger | `source` recorded | Who gets subscribed |
|---------|-------------------|---------------------|
| Create a task | `created` | the creator |
| Are added as an assignee (create / update / add-assignees) | `assigned` | each new assignee |
| Are `@mentioned` in a comment | `mentioned` | each mentioned user |
| Are `@mentioned` in a task description | `mentioned` | each mentioned user |
| Add a comment | `commented` | the commenter |
| Click "Watch" (manual) | `manual` | the current user |

> **FE implication:** because subscription happens automatically server-side, the
> current user's subscription state can change as a side effect of commenting,
> assigning, or creating. After those mutations, **invalidate the subscription
> queries** (see §6) so the UI reflects the new state.

Once subscribed, the user receives notifications through the **existing
notification channels** (REST + WebSocket, §7). Subscriptions persist until the
user unsubscribes; removing an assignee does **not** unsubscribe them.

---

## 2. Conventions (read this first)

- **REST wire format is `snake_case`** — request bodies, query params, and
  response fields (`user_id`, `full_name`, `created_at`, …). Do **not** expect
  camelCase from REST.
- **⚠️ The WebSocket payload is `camelCase`** (`actorId`, `entityType`,
  `entityId`, `createdAt`) — deliberately different from REST. Its nested
  `payload` object, however, is `snake_case`. Keep two separate types (§7).
- Errors use standard HTTP status codes with a body of
  `{ statusCode, message }`. `401` = missing/invalid token, `403` = forbidden,
  `404` = task/resource missing.

---

## 3. REST API reference — subscriptions

`taskId` is a **UUID**. All routes are guarded (send the Bearer token).

### Subscribe (watch) a task
```
POST /api/tasks/:taskId/subscription
→ 201 Created
{ "subscribed": true, "source": "manual", "since": "2026-07-04T10:00:00.000Z" }
→ 404 if the task does not exist
```

### Unsubscribe
```
DELETE /api/tasks/:taskId/subscription
→ 204 No Content        (idempotent — 204 even if not currently subscribed)
→ 404 if the task does not exist
```

### My subscription status
```
GET /api/tasks/:taskId/subscription/me
→ 200 OK
{ "subscribed": true,  "source": "assigned", "since": "2026-07-04T09:00:00.000Z" }
// or (task exists, you're not subscribed)
{ "subscribed": false, "source": null,       "since": null }
→ 404 if the task does not exist
```

### List a task's subscribers
```
GET /api/tasks/:taskId/subscribers
→ 200 OK
{
  "items": [
    {
      "user_id": "a1b2…",
      "full_name": "Alice Nguyen",
      "avatar_url": "https://…/a.png",
      "source": "assigned",
      "created_at": "2026-07-04T09:00:00.000Z"
    }
  ]
}
→ 404 if the task does not exist
```

---

## 4. TypeScript types

```ts
// src/features/subscriptions/types.ts

export type SubscriptionSource =
  | 'assigned'
  | 'mentioned'
  | 'commented'
  | 'manual'
  | 'created';

export interface SubscriptionStatus {
  subscribed: boolean;
  source: SubscriptionSource | null;
  since: string | null; // ISO 8601
}

export interface Subscriber {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  source: SubscriptionSource;
  created_at: string; // ISO 8601
}

export interface SubscriberListResponse {
  items: Subscriber[];
}
```

---

## 5. API client + React Query hooks

### 5.1 Minimal fetch client

Use your existing HTTP client if you have one; otherwise this thin wrapper
injects the token and normalizes errors.

```ts
// src/lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:1996/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Replace with however your app stores the access token.
function getToken(): string | null {
  return localStorage.getItem('access_token');
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
  return body as T;
}
```

```ts
// src/features/subscriptions/api.ts
import { apiFetch } from '../../lib/api';
import type { SubscriptionStatus, SubscriberListResponse } from './types';

export const subscriptionApi = {
  getMyStatus: (taskId: string) =>
    apiFetch<SubscriptionStatus>(`/tasks/${taskId}/subscription/me`),

  subscribe: (taskId: string) =>
    apiFetch<SubscriptionStatus>(`/tasks/${taskId}/subscription`, {
      method: 'POST',
    }),

  unsubscribe: (taskId: string) =>
    apiFetch<void>(`/tasks/${taskId}/subscription`, { method: 'DELETE' }),

  listSubscribers: (taskId: string) =>
    apiFetch<SubscriberListResponse>(`/tasks/${taskId}/subscribers`),
};
```

### 5.2 Query keys

```ts
// src/features/subscriptions/queryKeys.ts
export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  status: (taskId: string) => [...subscriptionKeys.all, 'status', taskId] as const,
  subscribers: (taskId: string) =>
    [...subscriptionKeys.all, 'list', taskId] as const,
};
```

### 5.3 Hooks (TanStack Query v5)

```ts
// src/features/subscriptions/hooks.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from './api';
import { subscriptionKeys } from './queryKeys';
import type { SubscriptionStatus, SubscriberListResponse } from './types';

export function useSubscriptionStatus(taskId: string) {
  return useQuery({
    queryKey: subscriptionKeys.status(taskId),
    queryFn: () => subscriptionApi.getMyStatus(taskId),
    enabled: !!taskId,
  });
}

export function useSubscribers(taskId: string) {
  return useQuery({
    queryKey: subscriptionKeys.subscribers(taskId),
    queryFn: () => subscriptionApi.listSubscribers(taskId),
    enabled: !!taskId,
  });
}

export function useSubscribe(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => subscriptionApi.subscribe(taskId),
    // Optimistic: flip the toggle immediately.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: subscriptionKeys.status(taskId) });
      const prev = qc.getQueryData<SubscriptionStatus>(
        subscriptionKeys.status(taskId),
      );
      qc.setQueryData<SubscriptionStatus>(subscriptionKeys.status(taskId), {
        subscribed: true,
        source: 'manual',
        since: new Date().toISOString(),
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(subscriptionKeys.status(taskId), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: subscriptionKeys.status(taskId) });
      qc.invalidateQueries({ queryKey: subscriptionKeys.subscribers(taskId) });
    },
  });
}

export function useUnsubscribe(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => subscriptionApi.unsubscribe(taskId),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: subscriptionKeys.status(taskId) });
      const prev = qc.getQueryData<SubscriptionStatus>(
        subscriptionKeys.status(taskId),
      );
      qc.setQueryData<SubscriptionStatus>(subscriptionKeys.status(taskId), {
        subscribed: false,
        source: null,
        since: null,
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(subscriptionKeys.status(taskId), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: subscriptionKeys.status(taskId) });
      qc.invalidateQueries({ queryKey: subscriptionKeys.subscribers(taskId) });
    },
  });
}
```

### 5.4 A "Watch" button

```tsx
// src/features/subscriptions/WatchButton.tsx
import {
  useSubscriptionStatus,
  useSubscribe,
  useUnsubscribe,
} from './hooks';

export function WatchButton({ taskId }: { taskId: string }) {
  const { data: status, isLoading } = useSubscriptionStatus(taskId);
  const subscribe = useSubscribe(taskId);
  const unsubscribe = useUnsubscribe(taskId);

  const watching = status?.subscribed ?? false;
  const pending = subscribe.isPending || unsubscribe.isPending;

  return (
    <button
      type="button"
      aria-pressed={watching}
      disabled={isLoading || pending}
      onClick={() => (watching ? unsubscribe.mutate() : subscribe.mutate())}
    >
      {watching ? 'Watching' : 'Watch'}
    </button>
  );
}
```

---

## 6. Keeping subscription state fresh after auto-subscribe

Because commenting / assigning / creating **auto-subscribes** the current user
server-side, invalidate the subscription queries in those mutations' `onSuccess`
so the "Watch" button and subscriber list update without a manual toggle.

```ts
// e.g. inside your "create comment" mutation
onSuccess: (_data, { taskId }) => {
  qc.invalidateQueries({ queryKey: subscriptionKeys.status(taskId) });
  qc.invalidateQueries({ queryKey: subscriptionKeys.subscribers(taskId) });
  // …plus your existing comments/activity invalidations
},
```

Do the same in the **assign-users** and **create-task** mutations.

---

## 7. Notifications (why subscriptions matter)

Subscribers receive notifications through two channels that already exist in the
backend. Subscriptions don't add new endpoints here — they change **who** these
notifications reach.

Notification `type` values: `comment_created`, `comment_mentioned`,
`task_assigned`, `task_updated`.

### 7.1 REST (persisted, source of truth)

All under `/api/notifications`, Bearer-guarded:

| Method & path | Purpose | Response |
|---------------|---------|----------|
| `GET /api/notifications?page&limit&is_read&type` | Paginated list | `{ data: Notification[], meta: { page, limit, total, totalPages } }` |
| `GET /api/notifications/unread-count` | Badge count | `{ count }` |
| `PATCH /api/notifications/read` (body `{ ids: string[] }`) | Mark some read | `{ updated }` |
| `PATCH /api/notifications/read-all` | Mark all read | `{ updated }` |
| `DELETE /api/notifications/:id` | Delete one | `204` |

```ts
export type NotificationType =
  | 'comment_created'
  | 'comment_mentioned'
  | 'task_assigned'
  | 'task_updated';

// REST shape — snake_case; `actor` is embedded, recipient/actor ids are stripped
export interface AppNotification {
  id: string;
  type: NotificationType;
  entity_type: 'task' | 'comment';
  entity_id: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  actor: { id: string; full_name: string; avatar_url: string | null } | null;
}
```

### 7.2 WebSocket (live push) — Socket.IO

Real-time delivery uses **Socket.IO** on the default namespace. The server pushes
a **`notification:new`** event to the recipient.

**Connecting** — pass the JWT in the handshake `auth.token`:

```ts
// src/lib/socket.ts
import { io, type Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:1996';

export function createSocket(token: string): Socket {
  return io(WS_URL, {
    auth: { token },          // read by the server's WsJwtGuard
    transports: ['websocket'],
    autoConnect: true,
  });
}
```

**Server → client events:**

| Event | Payload | Notes |
|-------|---------|-------|
| `connection:established` | `{ userId }` | Emitted on successful auth |
| `connection:error` | `{ message }` | Then the socket is disconnected |
| `notification:new` | see below | A new notification for you |
| `token:refresh:success` / `token:refresh:error` | `{}` / `{ message }` | Response to a `token:refresh` emit |

**Client → server events:**

| Event | Payload | Notes |
|-------|---------|-------|
| `token:refresh` | `{ token }` | Send a fresh access token before expiry to avoid a forced disconnect |

**⚠️ `notification:new` payload is `camelCase` (not snake_case), and carries no
notification `id`:**

```ts
export interface WsNotification {
  type: NotificationType;      // camelCase envelope…
  actorId: string;
  entityType: 'task' | 'comment';
  entityId: string;
  payload: Record<string, unknown>; // …but payload contents are snake_case
  createdAt: string;
}
```

Because the socket payload has no `id` and isn't the source of truth, treat
`notification:new` as a **signal to refetch**, not as a record to insert:

```ts
// src/features/notifications/useNotificationSocket.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSocket } from '../../lib/socket';
import type { WsNotification } from './types';

export function useNotificationSocket(token: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    const socket = createSocket(token);

    socket.on('notification:new', (n: WsNotification) => {
      // Refresh the badge + list from the REST source of truth.
      qc.invalidateQueries({ queryKey: ['notifications'] });

      // Optionally refresh the affected task's data.
      const taskId = (n.payload as { task_id?: string }).task_id;
      if (taskId) {
        qc.invalidateQueries({ queryKey: ['task', taskId] });
      }
    });

    socket.on('connection:error', (e) => console.warn('WS auth error', e));

    return () => {
      socket.off('notification:new');
      socket.disconnect();
    };
  }, [token, qc]);
}
```

### 7.3 `payload` shape by notification type

The `payload` (same in REST and WS) is `snake_case`:

```ts
// comment_created
{ task_id, task_title, ticket_id, comment_id, comment_preview,
  author: { id, full_name, avatar_url } }

// comment_mentioned
{ task_id, task_title, ticket_id, comment_id, comment_preview }

// task_assigned
{ task_id, task_title, ticket_id }

// task_updated  (currently only status changes)
{ task_id, task_title, ticket_id, changes: { status: { from, to } } }
```

---

## 8. Environment variables

```bash
# .env (Vite)
VITE_API_URL=http://localhost:1996/api
VITE_WS_URL=http://localhost:1996
```

---

## 9. Gotchas & operational notes

- **REST = snake_case, WebSocket envelope = camelCase.** Keep separate types;
  don't share a single interface across both channels.
- **Auto-subscribe changes state without an explicit call.** Invalidate
  `subscription/me` (and the subscribers list) after comment / assign / create
  mutations (§6).
- **`unsubscribe` is idempotent** — it returns `204` even if you weren't
  subscribed. Don't treat a repeat call as an error.
- **The `notification:new` socket event carries no notification `id`** and is not
  the source of truth — use it to trigger a REST refetch of the list /
  unread-count.
- **Actor self-exclusion:** you are never notified about your own action (e.g.
  your own comment), even though you get subscribed by it.
- **Single-instance delivery today:** live WebSocket push works when the backend
  runs as a single instance. Multi-instance/live push at scale needs the Redis
  Socket.IO adapter (not yet wired) — for correctness the REST endpoints remain
  authoritative regardless.
- **Token refresh:** emit `token:refresh` with a fresh access token before it
  expires; otherwise an expired token on reconnect triggers `connection:error`
  and a disconnect.
```
