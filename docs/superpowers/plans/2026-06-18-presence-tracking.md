# User Presence Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement KAN-76 — real-time user presence tracking over Socket.IO, with multi-tab/device support, project-scoped broadcasts, and a bulk REST endpoint for hover-card use.

**Architecture:** A new `PresenceModule` listens to NestJS lifecycle events (`ws.connection.opened` / `ws.connection.closed`) emitted by the existing `EventsGateway`. Connection state is held in-memory (`Map<userId, Set<socketId>>`). On first/last socket transitions for a user, the service broadcasts `presence:update` to that user's project rooms. A REST controller exposes `GET /presence?userIds=...` and `GET /presence/me`.

**Tech Stack:** NestJS 11, `@nestjs/event-emitter`, `@nestjs/websockets` + Socket.IO 4, TypeORM, class-validator, Jest.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `src/modules/presence/presence.module.ts` | Module wiring |
| `src/modules/presence/presence.service.ts` | In-memory state, room joining, broadcast on transitions, REST lookups |
| `src/modules/presence/presence.service.spec.ts` | Unit tests for service |
| `src/modules/presence/presence.controller.ts` | REST endpoints `/presence`, `/presence/me` |
| `src/modules/presence/presence.controller.spec.ts` | Unit tests for controller |
| `src/modules/presence/events/presence.events.ts` | Event-name constants and payload types |
| `src/modules/presence/dto/get-presence.dto.ts` | Query DTO with validation |
| `src/modules/presence/dto/presence-state.dto.ts` | Response shape for Swagger |

**Modified files:**

| File | Change |
|---|---|
| `src/modules/events/events.gateway.ts` | Inject `EventEmitter2`; emit `ws.connection.opened` after successful auth, `ws.connection.closed` on disconnect (only when user is known) |
| `src/modules/events/events.gateway.spec.ts` | Add tests for the new emits |
| `src/modules/events/events.module.ts` | No change — `EventEmitterModule.forRoot()` is already registered globally in `AppModule` |
| `src/app.module.ts` | Import `PresenceModule` |

**No DB migrations.** Per spec, state is in-memory only.

---

## Conventions referenced

- Existing gateway tests in `src/modules/events/events.gateway.spec.ts` show the mock-Socket pattern.
- `JwtAuthGuard` lives at `src/modules/auth/guards/jwt-auth.guard.ts` and is exported by `AuthModule`.
- `CurrentUser` decorator at `src/modules/auth/decorators/current-user.decorator.ts` — usage: `@CurrentUser('id') userId: string`.
- `ProjectMember` entity at `src/modules/project/project-member.entity.ts` — columns `project_id`, `user_id`.

---

## Task 1: Define presence event constants and payload types

**Files:**
- Create: `src/modules/presence/events/presence.events.ts`

- [ ] **Step 1: Create the events constants file**

```ts
// src/modules/presence/events/presence.events.ts

export const PRESENCE_EVENTS = {
  WS_CONNECTION_OPENED: 'ws.connection.opened',
  WS_CONNECTION_CLOSED: 'ws.connection.closed',
} as const;

export interface WsConnectionOpenedEvent {
  userId: string;
  socketId: string;
}

export interface WsConnectionClosedEvent {
  userId: string;
  socketId: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: PASS (no output errors).

- [ ] **Step 3: Commit**

```bash
git add src/modules/presence/events/presence.events.ts
git commit -m "feat(KAN-76): add presence connection-lifecycle event constants"
```

---

## Task 2: Emit `ws.connection.opened` / `ws.connection.closed` from EventsGateway

**Files:**
- Modify: `src/modules/events/events.gateway.ts`
- Modify: `src/modules/events/events.gateway.spec.ts`

- [ ] **Step 1: Add failing test for `ws.connection.opened` emit**

Open `src/modules/events/events.gateway.spec.ts`. In the existing top-level `describe('EventsGateway', ...)`:

Add to the imports at the top of the file:

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRESENCE_EVENTS } from '../presence/events/presence.events';
```

Add a mock right after `const mockWsJwtGuard = { ... };`:

```ts
const mockEventEmitter = {
  emit: jest.fn(),
};
```

In the `Test.createTestingModule` providers array for the `EventsGateway` suite, add:

```ts
{ provide: EventEmitter2, useValue: mockEventEmitter },
```

Then add a new test inside `describe('handleConnection', ...)`:

```ts
it('should emit ws.connection.opened after successful auth', async () => {
  const client = {
    id: 'socket-1',
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: { auth: { token: 'valid-token' } },
  } as unknown as Socket;

  await gateway.handleConnection(client);

  expect(mockEventEmitter.emit).toHaveBeenCalledWith(
    PRESENCE_EVENTS.WS_CONNECTION_OPENED,
    { userId: 'user-1', socketId: 'socket-1' },
  );
});

it('should NOT emit ws.connection.opened on auth failure', async () => {
  mockWsJwtGuard.validateToken.mockRejectedValueOnce(new Error('Invalid'));

  const client = {
    id: 'socket-2',
    data: {},
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: { auth: { token: 'bad-token' } },
  } as unknown as Socket;

  await gateway.handleConnection(client);

  expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
    PRESENCE_EVENTS.WS_CONNECTION_OPENED,
    expect.anything(),
  );
});
```

Add tests inside `describe('handleDisconnect', ...)`:

```ts
it('should emit ws.connection.closed when user is known', () => {
  const client = {
    id: 'socket-1',
    data: { user: mockUser },
  } as unknown as Socket;

  gateway.handleDisconnect(client);

  expect(mockEventEmitter.emit).toHaveBeenCalledWith(
    PRESENCE_EVENTS.WS_CONNECTION_CLOSED,
    { userId: 'user-1', socketId: 'socket-1' },
  );
});

it('should NOT emit ws.connection.closed when user is unknown', () => {
  const client = {
    id: 'socket-1',
    data: {},
  } as unknown as Socket;

  gateway.handleDisconnect(client);

  expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
    PRESENCE_EVENTS.WS_CONNECTION_CLOSED,
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=events.gateway.spec`
Expected: FAIL — the new four tests fail because `EventEmitter2` is not yet injected and emits aren't wired up.

- [ ] **Step 3: Modify `EventsGateway` to inject `EventEmitter2` and emit lifecycle events**

Edit `src/modules/events/events.gateway.ts`. Add import:

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRESENCE_EVENTS } from '../presence/events/presence.events';
```

Change the constructor:

```ts
constructor(
  private readonly wsJwtGuard: WsJwtGuard,
  private readonly eventEmitter: EventEmitter2,
) {}
```

In `handleConnection`, after `this.logger.log(...)` in the success path (i.e. inside the `try` block, after `client.emit('connection:established', ...)`), add:

```ts
this.eventEmitter.emit(PRESENCE_EVENTS.WS_CONNECTION_OPENED, {
  userId,
  socketId: client.id,
});
```

In `handleDisconnect`, replace the body with:

```ts
const user = client.data?.user;
const userId = user?.id;
this.logger.log(
  `Client disconnected: ${client.id} (user: ${userId ?? 'unknown'})`,
);
if (userId) {
  this.eventEmitter.emit(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, {
    userId,
    socketId: client.id,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=events.gateway.spec`
Expected: PASS — all tests in the file pass.

- [ ] **Step 5: Verify build is clean**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/events/events.gateway.ts src/modules/events/events.gateway.spec.ts
git commit -m "feat(KAN-76): emit ws.connection.opened/closed from EventsGateway"
```

---

## Task 3: PresenceService — connection state tracking

**Files:**
- Create: `src/modules/presence/presence.service.ts`
- Create: `src/modules/presence/presence.service.spec.ts`

- [ ] **Step 1: Write failing tests for state tracking**

Create `src/modules/presence/presence.service.spec.ts`:

```ts
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PresenceService } from './presence.service';
import { EventsGateway } from '../events/events.gateway';
import { ProjectMember } from '../project/project-member.entity';

describe('PresenceService', () => {
  let service: PresenceService;

  const mockProjectMemberRepo = {
    find: jest.fn(),
  };

  const mockServer = {
    in: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
    socketsJoin: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  };

  const mockGateway = {
    server: mockServer,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: EventsGateway, useValue: mockGateway },
        {
          provide: getRepositoryToken(ProjectMember),
          useValue: mockProjectMemberRepo,
        },
      ],
    }).compile();

    service = module.get<PresenceService>(PresenceService);
    mockProjectMemberRepo.find.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnectionOpened', () => {
    it('records the socket as connected for the user', async () => {
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });

      expect(service.isOnline('user-1')).toBe(true);
      expect(service.getConnectionCount('user-1')).toBe(1);
    });

    it('increments connection count for additional sockets', async () => {
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-2',
      });

      expect(service.getConnectionCount('user-1')).toBe(2);
    });
  });

  describe('handleConnectionClosed', () => {
    it('decrements connection count', async () => {
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-2',
      });

      await service.handleConnectionClosed({
        userId: 'user-1',
        socketId: 'socket-1',
      });

      expect(service.isOnline('user-1')).toBe(true);
      expect(service.getConnectionCount('user-1')).toBe(1);
    });

    it('marks user offline when last socket closes', async () => {
      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });
      await service.handleConnectionClosed({
        userId: 'user-1',
        socketId: 'socket-1',
      });

      expect(service.isOnline('user-1')).toBe(false);
      expect(service.getConnectionCount('user-1')).toBe(0);
    });

    it('is a no-op when closing an unknown socket', async () => {
      await expect(
        service.handleConnectionClosed({
          userId: 'user-1',
          socketId: 'never-connected',
        }),
      ).resolves.not.toThrow();

      expect(service.isOnline('user-1')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: FAIL — `PresenceService` doesn't exist.

- [ ] **Step 3: Create minimal `PresenceService`**

Create `src/modules/presence/presence.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventsGateway } from '../events/events.gateway';
import { ProjectMember } from '../project/project-member.entity';
import {
  PRESENCE_EVENTS,
  WsConnectionClosedEvent,
  WsConnectionOpenedEvent,
} from './events/presence.events';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly connections = new Map<string, Set<string>>();

  constructor(
    private readonly eventsGateway: EventsGateway,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
  ) {}

  @OnEvent(PRESENCE_EVENTS.WS_CONNECTION_OPENED, { async: true })
  async handleConnectionOpened(event: WsConnectionOpenedEvent): Promise<void> {
    const { userId, socketId } = event;
    const sockets = this.connections.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.connections.set(userId, sockets);
  }

  @OnEvent(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, { async: true })
  async handleConnectionClosed(event: WsConnectionClosedEvent): Promise<void> {
    const { userId, socketId } = event;
    const sockets = this.connections.get(userId);
    if (!sockets || !sockets.has(socketId)) return;

    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.connections.delete(userId);
    }
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: PASS — all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/presence.service.ts src/modules/presence/presence.service.spec.ts
git commit -m "feat(KAN-76): add PresenceService connection state tracking"
```

---

## Task 4: PresenceService — project room subscription on connect

**Files:**
- Modify: `src/modules/presence/presence.service.ts`
- Modify: `src/modules/presence/presence.service.spec.ts`

- [ ] **Step 1: Add failing tests for project room subscription**

Append a new `describe` block to `src/modules/presence/presence.service.spec.ts` (after `describe('handleConnectionClosed', ...)`):

```ts
describe('project room subscription', () => {
  it('joins the new socket to all project rooms on first connect', async () => {
    mockProjectMemberRepo.find.mockResolvedValue([
      { project_id: 'p1', user_id: 'user-1' },
      { project_id: 'p2', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    expect(mockProjectMemberRepo.find).toHaveBeenCalledWith({
      where: { user_id: 'user-1' },
      select: ['project_id'],
    });
    expect(mockServer.in).toHaveBeenCalledWith('socket-1');
    expect(mockServer.socketsJoin).toHaveBeenCalledWith([
      'project:p1',
      'project:p2',
    ]);
  });

  it('joins additional sockets to the same cached project rooms', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([
      { project_id: 'p1', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-2',
    });

    // Repo queried only once — second connect uses the cached set
    expect(mockProjectMemberRepo.find).toHaveBeenCalledTimes(1);
    expect(mockServer.in).toHaveBeenCalledWith('socket-2');
    expect(mockServer.socketsJoin).toHaveBeenLastCalledWith(['project:p1']);
  });

  it('skips socketsJoin when the user has no project memberships', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([]);

    await service.handleConnectionOpened({
      userId: 'lonely-user',
      socketId: 'socket-1',
    });

    expect(mockServer.socketsJoin).not.toHaveBeenCalled();
  });

  it('drops the project cache after the last socket disconnects', async () => {
    mockProjectMemberRepo.find
      .mockResolvedValueOnce([{ project_id: 'p1', user_id: 'user-1' }])
      .mockResolvedValueOnce([{ project_id: 'p2', user_id: 'user-1' }]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    await service.handleConnectionClosed({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-2',
    });

    // Second connect should re-query because cache was cleared
    expect(mockProjectMemberRepo.find).toHaveBeenCalledTimes(2);
    expect(mockServer.socketsJoin).toHaveBeenLastCalledWith(['project:p2']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: FAIL — the new four tests fail (repo not queried, socketsJoin never called).

- [ ] **Step 3: Implement project room subscription**

Edit `src/modules/presence/presence.service.ts`. Add a second map for cached project memberships at the top of the class, next to `connections`:

```ts
private readonly userProjects = new Map<string, Set<string>>();
```

Replace `handleConnectionOpened` with:

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_OPENED, { async: true })
async handleConnectionOpened(event: WsConnectionOpenedEvent): Promise<void> {
  const { userId, socketId } = event;

  const sockets = this.connections.get(userId) ?? new Set<string>();
  const isFirstSocket = sockets.size === 0;
  sockets.add(socketId);
  this.connections.set(userId, sockets);

  if (isFirstSocket) {
    const memberships = await this.projectMemberRepository.find({
      where: { user_id: userId },
      select: ['project_id'],
    });
    this.userProjects.set(
      userId,
      new Set(memberships.map((m) => m.project_id)),
    );
  }

  const rooms = Array.from(this.userProjects.get(userId) ?? []).map(
    (id) => `project:${id}`,
  );
  if (rooms.length > 0) {
    await this.eventsGateway.server.in(socketId).socketsJoin(rooms);
  }
}
```

Replace `handleConnectionClosed` with:

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, { async: true })
async handleConnectionClosed(event: WsConnectionClosedEvent): Promise<void> {
  const { userId, socketId } = event;
  const sockets = this.connections.get(userId);
  if (!sockets || !sockets.has(socketId)) return;

  sockets.delete(socketId);
  if (sockets.size === 0) {
    this.connections.delete(userId);
    this.userProjects.delete(userId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: PASS — all eight tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/presence.service.ts src/modules/presence/presence.service.spec.ts
git commit -m "feat(KAN-76): join sockets to project rooms in PresenceService"
```

---

## Task 5: PresenceService — broadcast `presence:update` on transitions

**Files:**
- Modify: `src/modules/presence/presence.service.ts`
- Modify: `src/modules/presence/presence.service.spec.ts`

- [ ] **Step 1: Add failing tests for broadcasting**

Append to `src/modules/presence/presence.service.spec.ts`:

```ts
describe('presence broadcasts', () => {
  it('broadcasts isOnline=true to each project room on first connect', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([
      { project_id: 'p1', user_id: 'user-1' },
      { project_id: 'p2', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    expect(mockServer.to).toHaveBeenCalledWith('project:p1');
    expect(mockServer.to).toHaveBeenCalledWith('project:p2');
    expect(mockServer.emit).toHaveBeenCalledWith(
      'presence:update',
      expect.objectContaining({
        userId: 'user-1',
        isOnline: true,
        connectionCount: 1,
        timestamp: expect.any(String),
      }),
    );
    // Once per room
    expect(mockServer.emit).toHaveBeenCalledTimes(2);
  });

  it('does not broadcast on second connect for the same user', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([
      { project_id: 'p1', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    mockServer.emit.mockClear();

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-2',
    });

    expect(mockServer.emit).not.toHaveBeenCalled();
  });

  it('does not broadcast when the user has no project memberships', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([]);

    await service.handleConnectionOpened({
      userId: 'lonely-user',
      socketId: 'socket-1',
    });

    expect(mockServer.emit).not.toHaveBeenCalled();
  });

  it('broadcasts isOnline=false to project rooms when the last socket closes', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([
      { project_id: 'p1', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    mockServer.emit.mockClear();
    mockServer.to.mockClear();

    await service.handleConnectionClosed({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    expect(mockServer.to).toHaveBeenCalledWith('project:p1');
    expect(mockServer.emit).toHaveBeenCalledWith(
      'presence:update',
      expect.objectContaining({
        userId: 'user-1',
        isOnline: false,
        connectionCount: 0,
      }),
    );
  });

  it('does not broadcast offline when a non-last socket closes', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([
      { project_id: 'p1', user_id: 'user-1' },
    ]);

    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-2',
    });
    mockServer.emit.mockClear();

    await service.handleConnectionClosed({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    expect(mockServer.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: FAIL — the five broadcast tests fail (no emit calls).

- [ ] **Step 3: Implement broadcasting**

Edit `src/modules/presence/presence.service.ts`. Replace `handleConnectionOpened`:

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_OPENED, { async: true })
async handleConnectionOpened(event: WsConnectionOpenedEvent): Promise<void> {
  const { userId, socketId } = event;

  const sockets = this.connections.get(userId) ?? new Set<string>();
  const isFirstSocket = sockets.size === 0;
  sockets.add(socketId);
  this.connections.set(userId, sockets);

  if (isFirstSocket) {
    const memberships = await this.projectMemberRepository.find({
      where: { user_id: userId },
      select: ['project_id'],
    });
    this.userProjects.set(
      userId,
      new Set(memberships.map((m) => m.project_id)),
    );
  }

  const rooms = Array.from(this.userProjects.get(userId) ?? []).map(
    (id) => `project:${id}`,
  );
  if (rooms.length === 0) return;

  await this.eventsGateway.server.in(socketId).socketsJoin(rooms);

  if (isFirstSocket) {
    this.broadcastPresence(userId, true, sockets.size, rooms);
  }
}
```

Replace `handleConnectionClosed`:

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, { async: true })
async handleConnectionClosed(event: WsConnectionClosedEvent): Promise<void> {
  const { userId, socketId } = event;
  const sockets = this.connections.get(userId);
  if (!sockets || !sockets.has(socketId)) return;

  sockets.delete(socketId);
  if (sockets.size > 0) return;

  const projectIds = this.userProjects.get(userId);
  this.connections.delete(userId);
  this.userProjects.delete(userId);

  if (!projectIds || projectIds.size === 0) return;
  const rooms = Array.from(projectIds).map((id) => `project:${id}`);
  this.broadcastPresence(userId, false, 0, rooms);
}
```

Add the helper method at the bottom of the class:

```ts
private broadcastPresence(
  userId: string,
  isOnline: boolean,
  connectionCount: number,
  rooms: string[],
): void {
  const payload = {
    userId,
    isOnline,
    connectionCount,
    timestamp: new Date().toISOString(),
  };
  for (const room of rooms) {
    this.eventsGateway.server.to(room).emit('presence:update', payload);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: PASS — all 13 tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/presence.service.ts src/modules/presence/presence.service.spec.ts
git commit -m "feat(KAN-76): broadcast presence:update on first/last socket transitions"
```

---

## Task 6: PresenceService — `getOnlineStates` lookup with `lastChangedAt`

**Files:**
- Modify: `src/modules/presence/presence.service.ts`
- Modify: `src/modules/presence/presence.service.spec.ts`

- [ ] **Step 1: Add failing tests for `getOnlineStates`**

Append to `src/modules/presence/presence.service.spec.ts`:

```ts
describe('getOnlineStates', () => {
  it('returns isOnline=true with connectionCount and lastChangedAt for online users', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([]);
    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    const result = service.getOnlineStates(['user-1']);

    expect(result).toEqual([
      {
        userId: 'user-1',
        isOnline: true,
        connectionCount: 1,
        lastChangedAt: expect.any(String),
      },
    ]);
  });

  it('returns isOnline=false and null lastChangedAt for never-seen users', () => {
    const result = service.getOnlineStates(['ghost-user']);

    expect(result).toEqual([
      {
        userId: 'ghost-user',
        isOnline: false,
        connectionCount: 0,
        lastChangedAt: null,
      },
    ]);
  });

  it('returns lastChangedAt for users who went offline', async () => {
    mockProjectMemberRepo.find.mockResolvedValueOnce([]);
    await service.handleConnectionOpened({
      userId: 'user-1',
      socketId: 'socket-1',
    });
    await service.handleConnectionClosed({
      userId: 'user-1',
      socketId: 'socket-1',
    });

    const result = service.getOnlineStates(['user-1']);

    expect(result[0]).toEqual({
      userId: 'user-1',
      isOnline: false,
      connectionCount: 0,
      lastChangedAt: expect.any(String),
    });
  });

  it('preserves input order and returns one entry per userId', () => {
    const result = service.getOnlineStates(['a', 'b', 'c']);

    expect(result.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: FAIL — `getOnlineStates` doesn't exist.

- [ ] **Step 3: Implement `getOnlineStates` and `lastChangedAt` tracking**

Edit `src/modules/presence/presence.service.ts`.

Add a third map alongside `connections` and `userProjects`:

```ts
private readonly lastChangedAt = new Map<string, string>();
```

Update `handleConnectionOpened` — when `isFirstSocket`, record the timestamp. Find the block that broadcasts after `isFirstSocket`. Add the timestamp update right after `sockets.add(socketId)` block, so it's set before the broadcast picks it up. Replace the body of `handleConnectionOpened` (keeping it idempotent with prior implementation):

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_OPENED, { async: true })
async handleConnectionOpened(event: WsConnectionOpenedEvent): Promise<void> {
  const { userId, socketId } = event;

  const sockets = this.connections.get(userId) ?? new Set<string>();
  const isFirstSocket = sockets.size === 0;
  sockets.add(socketId);
  this.connections.set(userId, sockets);

  if (isFirstSocket) {
    this.lastChangedAt.set(userId, new Date().toISOString());

    const memberships = await this.projectMemberRepository.find({
      where: { user_id: userId },
      select: ['project_id'],
    });
    this.userProjects.set(
      userId,
      new Set(memberships.map((m) => m.project_id)),
    );
  }

  const rooms = Array.from(this.userProjects.get(userId) ?? []).map(
    (id) => `project:${id}`,
  );
  if (rooms.length === 0) return;

  await this.eventsGateway.server.in(socketId).socketsJoin(rooms);

  if (isFirstSocket) {
    this.broadcastPresence(userId, true, sockets.size, rooms);
  }
}
```

And in `handleConnectionClosed`, record the timestamp when going offline. Replace it with:

```ts
@OnEvent(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, { async: true })
async handleConnectionClosed(event: WsConnectionClosedEvent): Promise<void> {
  const { userId, socketId } = event;
  const sockets = this.connections.get(userId);
  if (!sockets || !sockets.has(socketId)) return;

  sockets.delete(socketId);
  if (sockets.size > 0) return;

  this.lastChangedAt.set(userId, new Date().toISOString());

  const projectIds = this.userProjects.get(userId);
  this.connections.delete(userId);
  this.userProjects.delete(userId);

  if (!projectIds || projectIds.size === 0) return;
  const rooms = Array.from(projectIds).map((id) => `project:${id}`);
  this.broadcastPresence(userId, false, 0, rooms);
}
```

Add the public lookup method at the bottom of the class (after `broadcastPresence`):

```ts
getOnlineStates(userIds: string[]): PresenceState[] {
  return userIds.map((userId) => ({
    userId,
    isOnline: this.isOnline(userId),
    connectionCount: this.getConnectionCount(userId),
    lastChangedAt: this.lastChangedAt.get(userId) ?? null,
  }));
}
```

And add the type definition at the top of the file, after imports:

```ts
export interface PresenceState {
  userId: string;
  isOnline: boolean;
  connectionCount: number;
  lastChangedAt: string | null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=presence.service.spec`
Expected: PASS — all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/presence.service.ts src/modules/presence/presence.service.spec.ts
git commit -m "feat(KAN-76): add getOnlineStates with lastChangedAt tracking"
```

---

## Task 7: REST DTOs and `PresenceController`

**Files:**
- Create: `src/modules/presence/dto/get-presence.dto.ts`
- Create: `src/modules/presence/dto/presence-state.dto.ts`
- Create: `src/modules/presence/presence.controller.ts`
- Create: `src/modules/presence/presence.controller.spec.ts`

- [ ] **Step 1: Create the response DTO**

Create `src/modules/presence/dto/presence-state.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class PresenceStateDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId: string;

  @ApiProperty({ example: true })
  isOnline: boolean;

  @ApiProperty({ example: 1, description: 'Active socket count for the user' })
  connectionCount: number;

  @ApiProperty({
    example: '2026-06-18T15:50:59.391Z',
    nullable: true,
    description:
      'ISO timestamp of the last online↔offline transition during current server uptime; null if the user has never connected.',
  })
  lastChangedAt: string | null;
}

export class PresenceListResponseDto {
  @ApiProperty({ type: [PresenceStateDto] })
  items: PresenceStateDto[];
}
```

- [ ] **Step 2: Create the query DTO**

Create `src/modules/presence/dto/get-presence.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class GetPresenceQueryDto {
  @ApiProperty({
    description: 'Comma-separated list of user UUIDs (max 100)',
    example: 'a1b2c3d4-...,b2c3d4e5-...',
  })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return Array.from(new Set(value as string[]));
    if (typeof value !== 'string') return value;
    return Array.from(
      new Set(
        value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds: string[];
}
```

- [ ] **Step 3: Write failing controller tests**

Create `src/modules/presence/presence.controller.spec.ts`:

```ts
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

describe('PresenceController', () => {
  let controller: PresenceController;
  const mockService = {
    getOnlineStates: jest.fn(),
    isOnline: jest.fn(),
    getConnectionCount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PresenceController],
      providers: [{ provide: PresenceService, useValue: mockService }],
    }).compile();

    controller = module.get<PresenceController>(PresenceController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('GET /presence', () => {
    it('returns presence states for requested userIds', () => {
      mockService.getOnlineStates.mockReturnValueOnce([
        {
          userId: 'a',
          isOnline: true,
          connectionCount: 1,
          lastChangedAt: '2026-06-18T00:00:00.000Z',
        },
      ]);

      const result = controller.getMany({ userIds: ['a'] });

      expect(mockService.getOnlineStates).toHaveBeenCalledWith(['a']);
      expect(result).toEqual({
        items: [
          {
            userId: 'a',
            isOnline: true,
            connectionCount: 1,
            lastChangedAt: '2026-06-18T00:00:00.000Z',
          },
        ],
      });
    });
  });

  describe('GET /presence/me', () => {
    it('returns the current user’s presence state', () => {
      mockService.getOnlineStates.mockReturnValueOnce([
        {
          userId: 'me',
          isOnline: true,
          connectionCount: 2,
          lastChangedAt: '2026-06-18T00:00:00.000Z',
        },
      ]);

      const result = controller.getMe('me');

      expect(mockService.getOnlineStates).toHaveBeenCalledWith(['me']);
      expect(result).toEqual({
        userId: 'me',
        isOnline: true,
        connectionCount: 2,
        lastChangedAt: '2026-06-18T00:00:00.000Z',
      });
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm exec jest --testPathPattern=presence.controller.spec`
Expected: FAIL — `PresenceController` doesn't exist.

- [ ] **Step 5: Implement `PresenceController`**

Create `src/modules/presence/presence.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetPresenceQueryDto } from './dto/get-presence.dto';
import {
  PresenceListResponseDto,
  PresenceStateDto,
} from './dto/presence-state.dto';
import { PresenceService } from './presence.service';

@ApiTags('Presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get()
  @ApiOperation({ summary: 'Bulk presence lookup' })
  @ApiResponse({ status: 200, type: PresenceListResponseDto })
  getMany(@Query() query: GetPresenceQueryDto): PresenceListResponseDto {
    const items = this.presenceService.getOnlineStates(query.userIds);
    return { items };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user presence' })
  @ApiResponse({ status: 200, type: PresenceStateDto })
  getMe(@CurrentUser('id') userId: string): PresenceStateDto {
    const [state] = this.presenceService.getOnlineStates([userId]);
    return state;
  }
}
```

- [ ] **Step 6: Run controller tests to verify they pass**

Run: `pnpm exec jest --testPathPattern=presence.controller.spec`
Expected: PASS — both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/presence/dto src/modules/presence/presence.controller.ts src/modules/presence/presence.controller.spec.ts
git commit -m "feat(KAN-76): add PresenceController and DTOs"
```

---

## Task 8: Wire `PresenceModule` into `AppModule`

**Files:**
- Create: `src/modules/presence/presence.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `PresenceModule`**

Create `src/modules/presence/presence.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ProjectMember } from '../project/project-member.entity';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    EventsModule,
    AuthModule,
    TypeOrmModule.forFeature([ProjectMember]),
  ],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
```

- [ ] **Step 2: Register `PresenceModule` in `AppModule`**

Edit `src/app.module.ts`. Add the import alongside the other module imports:

```ts
import { PresenceModule } from './modules/presence/presence.module';
```

Add `PresenceModule` to the `imports` array (after `EventsModule`):

```ts
EventsModule,
PresenceModule,
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS — all tests across the repo green.

- [ ] **Step 4: Verify build is clean**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/presence/presence.module.ts src/app.module.ts
git commit -m "feat(KAN-76): register PresenceModule in AppModule"
```

---

## Task 9: Manual verification

This task verifies the wired-up system actually behaves correctly. No code changes — purely observational.

- [ ] **Step 1: Start the dev server**

Run: `pnpm start:dev`
Expected: Server starts on port 1996 with `WebSocket gateway initialized` in the logs.

- [ ] **Step 2: Open Swagger and confirm the endpoints are registered**

Browse to: `http://localhost:1996/api` (the existing Swagger UI route).
Expected: A new **Presence** tag with `GET /presence` and `GET /presence/me` endpoints.

- [ ] **Step 3: Connect two Socket.IO clients for the same user**

In two terminals, run a quick `wscat`-style snippet or use the existing frontend if available. The minimum check: open two Socket.IO connections with the same valid JWT, then close them one at a time.

Expected behavior:
- After the first connect, a third client connected with a different user that shares a project receives `presence:update { userId: <first-user>, isOnline: true }`.
- The second connect (same user) produces NO additional broadcast.
- Closing the first tab produces NO broadcast.
- Closing the second tab produces `presence:update { userId, isOnline: false }`.

- [ ] **Step 4: Verify REST endpoint**

With one client still connected, call:

```bash
curl -H "Authorization: Bearer <JWT>" \
  "http://localhost:1996/presence?userIds=<connected-user-id>,<other-user-id>"
```

Expected: `{ items: [{ userId, isOnline: true, connectionCount: 1, lastChangedAt: '<ISO>' }, { userId, isOnline: false, connectionCount: 0, lastChangedAt: null }] }`.

And:

```bash
curl -H "Authorization: Bearer <JWT>" http://localhost:1996/presence/me
```

Expected: Current user's state with `isOnline: true`.

- [ ] **Step 5: No commit needed**

This task is verification only. If anything misbehaves, file the bug back in the planning loop rather than patching ad-hoc.
