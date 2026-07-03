/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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

      service.handleConnectionClosed({
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
      service.handleConnectionClosed({
        userId: 'user-1',
        socketId: 'socket-1',
      });

      expect(service.isOnline('user-1')).toBe(false);
      expect(service.getConnectionCount('user-1')).toBe(0);
    });

    it('is a no-op when closing an unknown socket', () => {
      expect(() =>
        service.handleConnectionClosed({
          userId: 'user-1',
          socketId: 'never-connected',
        }),
      ).not.toThrow();

      expect(service.isOnline('user-1')).toBe(false);
    });
  });

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

    it('queues additional sockets until the first connect’s project query resolves', async () => {
      let resolveFind!: (
        value: { project_id: string; user_id: string }[],
      ) => void;
      mockProjectMemberRepo.find.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFind = resolve;
          }),
      );

      const open1 = service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });
      const open2 = service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-2',
      });

      resolveFind([{ project_id: 'p1', user_id: 'user-1' }]);

      await Promise.all([open1, open2]);

      // Both sockets must be joined to the project room — not just the first.
      expect(mockServer.in).toHaveBeenCalledWith('socket-1');
      expect(mockServer.in).toHaveBeenCalledWith('socket-2');
      expect(mockServer.socketsJoin).toHaveBeenCalledTimes(2);
      expect(mockServer.socketsJoin).toHaveBeenNthCalledWith(1, ['project:p1']);
      expect(mockServer.socketsJoin).toHaveBeenNthCalledWith(2, ['project:p1']);
      // The DB should still be queried only once — the second event awaits the cached promise.
      expect(mockProjectMemberRepo.find).toHaveBeenCalledTimes(1);
    });

    it('drops the project cache after the last socket disconnects', async () => {
      mockProjectMemberRepo.find
        .mockResolvedValueOnce([{ project_id: 'p1', user_id: 'user-1' }])
        .mockResolvedValueOnce([{ project_id: 'p2', user_id: 'user-1' }]);

      await service.handleConnectionOpened({
        userId: 'user-1',
        socketId: 'socket-1',
      });
      service.handleConnectionClosed({
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

      service.handleConnectionClosed({
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

      service.handleConnectionClosed({
        userId: 'user-1',
        socketId: 'socket-1',
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

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
      service.handleConnectionClosed({
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
});
