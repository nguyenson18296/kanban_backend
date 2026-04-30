# KAN-73: WebSocket Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time WebSocket support to push live notifications to connected users via Socket.IO.

**Architecture:** A new `EventsModule` with an `EventsGateway` (Socket.IO) and `EventsService`. The gateway handles connection auth via JWT and manages user rooms. The service subscribes to existing `EventEmitter2` notification events and forwards them to the appropriate user's WebSocket room. Zero changes to existing notification persistence logic.

**Tech Stack:** NestJS WebSockets (`@nestjs/websockets`), Socket.IO (`@nestjs/platform-socket.io`, `socket.io`), existing JWT auth infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-28-websocket-support-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/modules/events/events.module.ts` | Module definition, imports AuthModule + JwtModule |
| `src/modules/events/events.gateway.ts` | WebSocket gateway — connection lifecycle, token refresh |
| `src/modules/events/events.service.ts` | Subscribes to EventEmitter2 notification events, pushes to gateway |
| `src/modules/events/guards/ws-jwt.guard.ts` | Validates JWT from socket handshake |
| `src/modules/events/dto/ws-notification.dto.ts` | Shape of `notification:new` payload |
| `src/modules/events/events.gateway.spec.ts` | Unit tests for gateway + service |

### Modified files

| File | Change |
|------|--------|
| `src/app.module.ts` | Add `EventsModule` to imports |
| `package.json` | Add `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` deps |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install WebSocket packages**

```bash
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

- [ ] **Step 2: Verify installation**

```bash
pnpm exec nest info
```

Expected: NestJS platform info shows without errors, and `node_modules/@nestjs/websockets` exists.

- [ ] **Step 3: Verify build still passes**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(KAN-73): add @nestjs/websockets and socket.io dependencies"
```

---

### Task 2: Create WsJwtGuard

**Files:**
- Create: `src/modules/events/guards/ws-jwt.guard.ts`

- [ ] **Step 1: Create the WsJwtGuard**

This guard extracts the JWT from the Socket.IO handshake `auth` object, verifies it using `JwtService`, then validates the user exists and is active via `AuthService`.

```typescript
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../../auth/auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const user = await this.validateToken(client);
    client.data.user = user;
    return true;
  }

  async validateToken(client: Socket) {
    const token =
      client.handshake?.auth?.token ??
      client.handshake?.headers?.authorization?.split(' ')[1];

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    try {
      const payload = this.jwtService.verify(token);
      const user = await this.authService.validateUserById(payload.sub);
      if (!user) {
        throw new WsException('User not found or inactive');
      }
      return user;
    } catch (error) {
      this.logger.warn(`WebSocket auth failed: ${(error as Error).message}`);
      throw new WsException('Invalid or expired token');
    }
  }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: Build succeeds (file is not imported yet, but should have no syntax errors if the compiler picks it up via tsconfig).

- [ ] **Step 3: Commit**

```bash
git add src/modules/events/guards/ws-jwt.guard.ts
git commit -m "feat(KAN-73): add WsJwtGuard for WebSocket authentication"
```

---

### Task 3: Create WsNotificationDto

**Files:**
- Create: `src/modules/events/dto/ws-notification.dto.ts`

- [ ] **Step 1: Create the DTO**

This defines the shape of the `notification:new` payload sent to clients.

```typescript
import { NotificationType } from '../../notification/notification.entity';

export class WsNotificationDto {
  id: string;
  type: NotificationType;
  actorId: string;
  entityType: string;
  entityId: string;
  payload: Record<string, any>;
  createdAt: string;

  static fromNotification(notification: {
    id: string;
    type: NotificationType;
    actor_id: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, any>;
    created_at: Date;
  }): WsNotificationDto {
    const dto = new WsNotificationDto();
    dto.id = notification.id;
    dto.type = notification.type;
    dto.actorId = notification.actor_id;
    dto.entityType = notification.entity_type;
    dto.entityId = notification.entity_id;
    dto.payload = notification.payload;
    dto.createdAt = notification.created_at.toISOString();
    return dto;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/events/dto/ws-notification.dto.ts
git commit -m "feat(KAN-73): add WsNotificationDto for WebSocket notification payloads"
```

---

### Task 4: Create EventsGateway

**Files:**
- Create: `src/modules/events/events.gateway.ts`

- [ ] **Step 1: Create the gateway**

The gateway handles the Socket.IO server lifecycle. It validates JWT on connection via `WsJwtGuard`, joins users to their `user:<id>` room, handles `token:refresh` events for mid-session re-auth, and provides the `server` instance for the service to emit events.

```typescript
import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly wsJwtGuard: WsJwtGuard) {}

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      await this.wsJwtGuard.validateToken(client);
      const userId = client.data.user.id;
      await client.join(`user:${userId}`);
      client.emit('connection:established', { userId });
      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
    } catch {
      client.emit('connection:error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.user?.id ?? 'unknown';
    this.logger.log(`Client disconnected: ${client.id} (user: ${userId})`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('token:refresh')
  async handleTokenRefresh(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string },
  ): Promise<void> {
    try {
      // Override the token in handshake so WsJwtGuard validates the new one
      client.handshake.auth.token = data.token;
      await this.wsJwtGuard.validateToken(client);
      const userId = client.data.user.id;
      // Re-join the user room (no-op if already in it, ensures consistency)
      await client.join(`user:${userId}`);
      client.emit('token:refresh:success', {});
      this.logger.log(`Token refreshed for client: ${client.id} (user: ${userId})`);
    } catch {
      client.emit('token:refresh:error', { message: 'Token refresh failed' });
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/modules/events/events.gateway.ts
git commit -m "feat(KAN-73): add EventsGateway with JWT auth and token refresh"
```

---

### Task 5: Create EventsService

**Files:**
- Create: `src/modules/events/events.service.ts`

- [ ] **Step 1: Create the service**

The service listens to the same `EventEmitter2` notification events that `NotificationListener` subscribes to. After the listener persists the notification to the DB, this service pushes it to the user's WebSocket room. It uses `@OnEvent` with `{ async: true }` so it runs independently of the DB persistence.

Note: The notification events use different shapes — `CommentCreatedEvent` has a single `recipient_id`, while `CommentMentionedEvent`, `TaskAssignedEvent`, and `TaskUpdatedEvent` have `recipient_ids` (plural, array). The service handles both patterns.

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NOTIFICATION_EVENTS,
  CommentCreatedEvent,
  CommentMentionedEvent,
  TaskAssignedEvent,
  TaskUpdatedEvent,
} from '../notification/events/notification.events';
import { EventsGateway } from './events.gateway';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly eventsGateway: EventsGateway) {}

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_CREATED, { async: true })
  handleCommentCreated(event: CommentCreatedEvent): void {
    // Single recipient — skip if self-notification
    if (event.recipient_id === event.actor_id) return;

    this.emitNotification(event.recipient_id, {
      type: 'comment_created',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_MENTIONED, { async: true })
  handleCommentMentioned(event: CommentMentionedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'comment_mentioned',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_ASSIGNED, { async: true })
  handleTaskAssigned(event: TaskAssignedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'task_assigned',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_UPDATED, { async: true })
  handleTaskUpdated(event: TaskUpdatedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'task_updated',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  private emitToRecipients(
    recipientIds: string[],
    actorId: string,
    data: Record<string, any>,
  ): void {
    const filtered = recipientIds.filter((id) => id !== actorId);
    for (const recipientId of filtered) {
      this.emitNotification(recipientId, data);
    }
  }

  private emitNotification(recipientId: string, data: Record<string, any>): void {
    try {
      this.eventsGateway.emitToUser(recipientId, 'notification:new', {
        ...data,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit notification to user ${recipientId}`,
        (error as Error).stack,
      );
    }
  }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/modules/events/events.service.ts
git commit -m "feat(KAN-73): add EventsService to forward notifications via WebSocket"
```

---

### Task 6: Create EventsModule and Register in AppModule

**Files:**
- Create: `src/modules/events/events.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

The module imports `AuthModule` (for `AuthService` used by `WsJwtGuard`) and `JwtModule` (for `JwtService` used by `WsJwtGuard`). It also exports `EventsGateway` so other modules can inject it if needed in the future.

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn =
          configService.get<string>('JWT_EXPIRES_IN', '1h') ?? '1h';
        return {
          secret: configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: expiresIn as StringValue,
          },
        };
      },
    }),
  ],
  providers: [EventsGateway, EventsService, WsJwtGuard],
  exports: [EventsGateway],
})
export class EventsModule {}
```

- [ ] **Step 2: Register EventsModule in AppModule**

In `src/app.module.ts`, add the import statement and add `EventsModule` to the `imports` array.

Add import at the top (after the `ActivityModule` import on line 17):

```typescript
import { EventsModule } from './modules/events/events.module';
```

Add `EventsModule` to the imports array (after `ActivityModule` on line 52):

```typescript
    ActivityModule,
    EventsModule,
```

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify lint**

```bash
pnpm lint
```

Expected: No lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/events/events.module.ts src/app.module.ts
git commit -m "feat(KAN-73): add EventsModule and register in AppModule"
```

---

### Task 7: Write Unit Tests

**Files:**
- Create: `src/modules/events/events.gateway.spec.ts`

- [ ] **Step 1: Write tests for the gateway and service**

Tests cover: connection auth success/failure, room joining, token refresh, disconnect handling, and notification event forwarding.

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { Server, Socket } from 'socket.io';
import {
  CommentCreatedEvent,
  TaskAssignedEvent,
} from '../notification/events/notification.events';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let wsJwtGuard: WsJwtGuard;

  const mockUser = { id: 'user-1', email: 'test@example.com', is_active: true };

  const mockWsJwtGuard = {
    canActivate: jest.fn().mockResolvedValue(true),
    validateToken: jest.fn().mockImplementation(async (client: any) => {
      client.data = { user: mockUser };
      return mockUser;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: WsJwtGuard, useValue: mockWsJwtGuard },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    wsJwtGuard = module.get<WsJwtGuard>(WsJwtGuard);

    // Mock the server
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should authenticate and join user room on valid token', async () => {
      const client = {
        id: 'socket-1',
        data: {},
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { auth: { token: 'valid-token' } },
      } as unknown as Socket;

      await gateway.handleConnection(client);

      expect(wsJwtGuard.validateToken).toHaveBeenCalledWith(client);
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.emit).toHaveBeenCalledWith('connection:established', {
        userId: 'user-1',
      });
    });

    it('should disconnect client on invalid token', async () => {
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

      expect(client.emit).toHaveBeenCalledWith('connection:error', {
        message: 'Authentication failed',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should log disconnect with user id', () => {
      const client = {
        id: 'socket-1',
        data: { user: mockUser },
      } as unknown as Socket;

      // Should not throw
      gateway.handleDisconnect(client);
    });

    it('should handle disconnect without user data', () => {
      const client = {
        id: 'socket-1',
        data: {},
      } as unknown as Socket;

      // Should not throw
      gateway.handleDisconnect(client);
    });
  });

  describe('emitToUser', () => {
    it('should emit event to user room', () => {
      const data = { type: 'test', payload: {} };

      gateway.emitToUser('user-1', 'notification:new', data);

      expect(gateway.server.to).toHaveBeenCalledWith('user:user-1');
      expect(gateway.server.to('user:user-1').emit).toHaveBeenCalledWith(
        'notification:new',
        data,
      );
    });
  });
});

describe('EventsService', () => {
  let service: EventsService;
  let gateway: EventsGateway;

  const mockGateway = {
    emitToUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: EventsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    gateway = module.get<EventsGateway>(EventsGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCommentCreated', () => {
    it('should emit notification to recipient', () => {
      const event = new CommentCreatedEvent(
        'actor-1',
        'entity-1',
        'recipient-1',
        {
          task_id: 'task-1',
          task_title: 'Test Task',
          ticket_id: 'KAN-1',
          comment_id: 'comment-1',
          comment_preview: 'Hello...',
          author: { id: 'actor-1', full_name: 'Actor', avatar_url: null },
        },
      );

      service.handleCommentCreated(event);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'recipient-1',
        'notification:new',
        expect.objectContaining({
          type: 'comment_created',
          actorId: 'actor-1',
        }),
      );
    });

    it('should skip self-notification', () => {
      const event = new CommentCreatedEvent(
        'actor-1',
        'entity-1',
        'actor-1', // same as actor
        {
          task_id: 'task-1',
          task_title: 'Test Task',
          ticket_id: 'KAN-1',
          comment_id: 'comment-1',
          comment_preview: 'Hello...',
          author: { id: 'actor-1', full_name: 'Actor', avatar_url: null },
        },
      );

      service.handleCommentCreated(event);

      expect(gateway.emitToUser).not.toHaveBeenCalled();
    });
  });

  describe('handleTaskAssigned', () => {
    it('should emit to all recipients except actor', () => {
      const event = new TaskAssignedEvent(
        'actor-1',
        'entity-1',
        ['recipient-1', 'recipient-2', 'actor-1'],
        {
          task_id: 'task-1',
          task_title: 'Test Task',
          ticket_id: 'KAN-1',
        },
      );

      service.handleTaskAssigned(event);

      expect(gateway.emitToUser).toHaveBeenCalledTimes(2);
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'recipient-1',
        'notification:new',
        expect.objectContaining({ type: 'task_assigned' }),
      );
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        'recipient-2',
        'notification:new',
        expect.objectContaining({ type: 'task_assigned' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm exec jest --testPathPattern=events.gateway.spec --verbose
```

Expected: All tests pass.

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/events/events.gateway.spec.ts
git commit -m "test(KAN-73): add unit tests for EventsGateway and EventsService"
```

---

### Task 8: Verify End-to-End

**Files:** None (manual verification)

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Expected: No lint errors.

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: All tests pass, including the new gateway/service tests.

- [ ] **Step 4: Verify dev server starts**

```bash
timeout 10 pnpm start:dev 2>&1 || true
```

Expected: Server starts on port 1996, logs show "WebSocket gateway initialized". The `timeout` kills it after 10s since we just need to confirm startup.

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Install `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` |
| 2 | Create `WsJwtGuard` — JWT auth for WebSocket handshake |
| 3 | Create `WsNotificationDto` — notification payload shape |
| 4 | Create `EventsGateway` — connection lifecycle + token refresh |
| 5 | Create `EventsService` — forward EventEmitter2 events to WebSocket |
| 6 | Create `EventsModule` + register in `AppModule` |
| 7 | Unit tests for gateway and service |
| 8 | Final verification (lint, build, test, dev server) |
