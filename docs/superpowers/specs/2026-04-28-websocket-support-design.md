# KAN-73: WebSocket Support Design

## Overview

Add real-time WebSocket support to the Kanban backend, starting with live notification delivery. The design is scoped to notifications now but structured to support board updates (live task/column changes) in the future.

## Architecture

A new `EventsModule` acts as the WebSocket infrastructure layer, independent of existing modules:

```
Client (Socket.IO)
  ↕ WSS connection (JWT handshake auth)
  ↕
EventsGateway (@WebSocketGateway)
  ├── WsJwtGuard — validates JWT on connection, rejects unauthorized
  ├── auto-joins user to room `user:<userId>`
  ├── handles `token:refresh` event for re-auth mid-session
  └── emits `notification:new` to user rooms
  ↕
EventsService
  ├── listens to EventEmitter2 notification events
  ├── resolves recipient → room mapping
  └── pushes to gateway.server.to(`user:<id>`)
```

The existing `NotificationListener` continues to persist notifications to the DB. `EventsService` subscribes to the same `EventEmitter2` events independently — zero changes to existing notification code.

## Event Types & Message Structure

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `notification:new` | `{ type, actorId, entityType, entityId, payload, createdAt }` | New notification for the user (lightweight push; `createdAt` is emit-time, not DB-persisted; no `id` since this fires before DB persistence — client can fetch the full notification via REST if needed) |
| `connection:established` | `{ userId }` | Confirms successful auth |
| `connection:error` | `{ message }` | Auth failure, followed by disconnect |
| `token:refresh:success` | `{}` | Token refresh accepted |
| `token:refresh:error` | `{ message }` | Token refresh failed, followed by disconnect |

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `token:refresh` | `{ token }` | Submit a fresh JWT to extend the session |

## Connection Lifecycle & Auth Flow

### Handshake (connect)

1. Client connects with `{ auth: { token: '<JWT>' } }`
2. `WsJwtGuard` extracts and verifies the JWT using `JWT_SECRET`
3. Validates the user exists and is active (same logic as `JwtStrategy`)
4. If valid: attaches user to `socket.data.user`, joins `user:<userId>` room, emits `connection:established`
5. If invalid: emits `connection:error`, disconnects the socket

### Mid-session re-auth (token:refresh)

1. Client's access token approaches expiry (client tracks this)
2. Client calls REST `POST /api/auth/refresh` to get a new access token (existing flow)
3. Client emits `token:refresh` with the new access token
4. Gateway validates the new token, updates `socket.data.user`
5. Emits `token:refresh:success` or `token:refresh:error` (disconnect on failure)

### Disconnect

- Socket.IO automatically removes the socket from all rooms
- No custom cleanup needed

### Multiple devices/tabs

- Each connection gets its own socket, all join the same `user:<userId>` room
- Notifications reach all active sessions automatically

## Room Strategy

| Room pattern | Purpose | When joined |
|--------------|---------|-------------|
| `user:<userId>` | Per-user notifications | On connect (automatic) |
| `project:<projectId>` | Board updates (future) | On explicit join (not implemented yet) |

## Offline Users

No special handling. Notifications are already persisted to the DB by `NotificationListener`. Offline users see them when they next fetch via the REST API. WebSocket is purely a live-push layer.

## File Structure

### New files

```
src/modules/events/
├── events.module.ts            — module definition, imports JwtModule
├── events.gateway.ts           — @WebSocketGateway, connect/disconnect/token:refresh
├── events.service.ts           — listens to EventEmitter2, pushes to gateway
├── guards/
│   └── ws-jwt.guard.ts         — JWT validation for WebSocket handshake
├── dto/
│   └── ws-notification.dto.ts  — shape of notification:new payload
└── events.gateway.spec.ts      — unit tests
```

### Modified files

```
src/app.module.ts   — import EventsModule
package.json        — add @nestjs/websockets, @nestjs/platform-socket.io, socket.io
```

### No changes to existing modules

`EventsService` subscribes to the same `EventEmitter2` events that `NotificationListener` already listens to. Zero coupling to existing code.

## Dependencies to Add

```
@nestjs/websockets
@nestjs/platform-socket.io
socket.io
```

## CORS

Socket.IO gateway will use `origin: '*'` to match the current REST API CORS config, set in the `@WebSocketGateway` decorator options.

## Future Extensibility

- **Board updates (KAN-73 phase 2):** Add `project:<projectId>` rooms. `EventsGateway` handles `board:join` / `board:leave` events. `EventsService` subscribes to task/column events and broadcasts to project rooms.
- **Redis adapter:** If the app scales to multiple server instances, add `@socket.io/redis-adapter` to share state across processes.
- **Queued delivery:** If offline delivery becomes a requirement, buffer missed events in Redis and flush on reconnect.
