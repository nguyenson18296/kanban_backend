/// <reference types="jest" />
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
