/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { Socket } from 'socket.io';
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
    validateToken: jest.fn().mockResolvedValue(mockUser),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: WsJwtGuard, useValue: mockWsJwtGuard },
      ],
    })
      .overrideGuard(WsJwtGuard)
      .useValue(mockWsJwtGuard)
      .compile();

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
      expect(client.data.user).toBe(mockUser);
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

  describe('handleTokenRefresh', () => {
    it('should validate new token, update client.data.user, and re-join room', async () => {
      const refreshedUser = {
        id: 'user-1',
        email: 'test@example.com',
        is_active: true,
      };
      mockWsJwtGuard.validateToken.mockResolvedValueOnce(refreshedUser);

      const client = {
        id: 'socket-1',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { auth: { token: 'old-token' } },
      } as unknown as Socket;

      await gateway.handleTokenRefresh(client, { token: 'new-token' });

      expect(client.handshake.auth.token).toBe('new-token');
      expect(wsJwtGuard.validateToken).toHaveBeenCalledWith(client);
      expect(client.data.user).toBe(refreshedUser);
      expect(client.join).toHaveBeenCalledWith('user:user-1');
      expect(client.emit).toHaveBeenCalledWith('token:refresh:success', {});
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should handle missing handshake.auth gracefully', async () => {
      const refreshedUser = {
        id: 'user-1',
        email: 'test@example.com',
        is_active: true,
      };
      mockWsJwtGuard.validateToken.mockResolvedValueOnce(refreshedUser);

      const client = {
        id: 'socket-1',
        data: { user: mockUser },
        join: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { auth: undefined },
      } as unknown as Socket;

      await gateway.handleTokenRefresh(client, { token: 'new-token' });

      expect(client.handshake.auth).toEqual({ token: 'new-token' });
      expect(client.data.user).toBe(refreshedUser);
      expect(client.emit).toHaveBeenCalledWith('token:refresh:success', {});
    });

    it('should disconnect client on expired/invalid token', async () => {
      mockWsJwtGuard.validateToken.mockRejectedValueOnce(
        new Error('Token expired'),
      );

      const client = {
        id: 'socket-1',
        data: { user: mockUser },
        join: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { auth: { token: 'old-token' } },
      } as unknown as Socket;

      await gateway.handleTokenRefresh(client, { token: 'expired-token' });

      expect(client.handshake.auth.token).toBe('expired-token');
      expect(client.emit).toHaveBeenCalledWith('token:refresh:error', {
        message: 'Token refresh failed',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
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
