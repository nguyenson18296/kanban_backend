/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionSource } from './task-subscription.entity';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;

  const mockService = {
    ensureTaskExists: jest.fn(),
    subscribe: jest.fn(),
    subscribeStrict: jest.fn(),
    unsubscribe: jest.fn(),
    getMyStatus: jest.fn(),
    listSubscribers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [{ provide: SubscriptionService, useValue: mockService }],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    mockService.ensureTaskExists.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('subscribe (manual)', () => {
    it('validates the task, subscribes strictly, and returns status', async () => {
      mockService.subscribeStrict.mockResolvedValueOnce(undefined);
      mockService.getMyStatus.mockResolvedValueOnce({
        subscribed: true,
        source: SubscriptionSource.MANUAL,
        since: '2026-07-04T00:00:00.000Z',
      });

      const res = await controller.subscribe('t1', 'u1');

      expect(mockService.ensureTaskExists).toHaveBeenCalledWith('t1');
      expect(mockService.subscribeStrict).toHaveBeenCalledWith(
        't1',
        'u1',
        SubscriptionSource.MANUAL,
      );
      expect(res.subscribed).toBe(true);
    });

    it('propagates a strict subscribe failure (no false 201)', async () => {
      mockService.subscribeStrict.mockRejectedValueOnce(new Error('db down'));

      await expect(controller.subscribe('t1', 'u1')).rejects.toThrow('db down');
      expect(mockService.getMyStatus).not.toHaveBeenCalled();
    });
  });

  describe('listSubscribers', () => {
    it('404s and does not list when the task is missing', async () => {
      mockService.ensureTaskExists.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        controller.listSubscribers('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockService.listSubscribers).not.toHaveBeenCalled();
    });

    it('validates the task then maps subscribers to the response shape', async () => {
      mockService.listSubscribers.mockResolvedValueOnce([
        {
          user_id: 'u1',
          source: SubscriptionSource.ASSIGNED,
          created_at: new Date('2026-07-04T00:00:00.000Z'),
          user: { full_name: 'Alice', avatar_url: null },
        },
      ]);

      const res = await controller.listSubscribers('t1');

      expect(mockService.ensureTaskExists).toHaveBeenCalledWith('t1');
      expect(res.items).toEqual([
        {
          user_id: 'u1',
          full_name: 'Alice',
          avatar_url: null,
          source: SubscriptionSource.ASSIGNED,
          created_at: '2026-07-04T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('getMyStatus', () => {
    it('404s and does not read status when the task is missing', async () => {
      mockService.ensureTaskExists.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        controller.getMyStatus('missing', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockService.getMyStatus).not.toHaveBeenCalled();
    });
  });
});
