/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import {
  TaskSubscription,
  SubscriptionSource,
} from './task-subscription.entity';
import { Task } from '../task/task.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };

  const mockSubRepo = {
    createQueryBuilder: jest.fn(() => qb),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    existsBy: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
  };

  const mockTaskRepo = {
    existsBy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: getRepositoryToken(TaskSubscription),
          useValue: mockSubRepo,
        },
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('subscribe', () => {
    it('inserts with orIgnore (idempotent) and the given values', async () => {
      await service.subscribe('t1', 'u1', SubscriptionSource.COMMENTED);

      expect(qb.values).toHaveBeenCalledWith({
        task_id: 't1',
        user_id: 'u1',
        source: SubscriptionSource.COMMENTED,
      });
      expect(qb.orIgnore).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalled();
    });

    it('is resilient: swallows repo errors and does not throw', async () => {
      qb.execute.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.subscribe('t1', 'u1', SubscriptionSource.MANUAL),
      ).resolves.toBeUndefined();
    });
  });

  describe('subscribeStrict', () => {
    it('inserts idempotently (orIgnore) like subscribe', async () => {
      await service.subscribeStrict('t1', 'u1', SubscriptionSource.MANUAL);
      expect(qb.values).toHaveBeenCalledWith({
        task_id: 't1',
        user_id: 'u1',
        source: SubscriptionSource.MANUAL,
      });
      expect(qb.orIgnore).toHaveBeenCalled();
    });

    it('rethrows on repo failure (no false success for the manual endpoint)', async () => {
      qb.execute.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.subscribeStrict('t1', 'u1', SubscriptionSource.MANUAL),
      ).rejects.toThrow('db down');
    });
  });

  describe('subscribeMany', () => {
    it('no-ops on an empty list (no query issued)', async () => {
      await service.subscribeMany('t1', [], SubscriptionSource.ASSIGNED);
      expect(mockSubRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('dedupes ids and batch-inserts', async () => {
      await service.subscribeMany(
        't1',
        ['u1', 'u1', 'u2'],
        SubscriptionSource.ASSIGNED,
      );
      expect(qb.values).toHaveBeenCalledWith([
        { task_id: 't1', user_id: 'u1', source: SubscriptionSource.ASSIGNED },
        { task_id: 't1', user_id: 'u2', source: SubscriptionSource.ASSIGNED },
      ]);
      expect(qb.orIgnore).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('deletes the composite-keyed row', async () => {
      await service.unsubscribe('t1', 'u1');
      expect(mockSubRepo.delete).toHaveBeenCalledWith({
        task_id: 't1',
        user_id: 'u1',
      });
    });
  });

  describe('getMyStatus', () => {
    it('reports subscribed with source and since', async () => {
      mockSubRepo.findOneBy.mockResolvedValueOnce({
        source: SubscriptionSource.MANUAL,
        created_at: new Date('2026-07-03T00:00:00.000Z'),
      });
      const status = await service.getMyStatus('t1', 'u1');
      expect(status).toEqual({
        subscribed: true,
        source: SubscriptionSource.MANUAL,
        since: '2026-07-03T00:00:00.000Z',
      });
    });

    it('reports not subscribed when no row exists', async () => {
      mockSubRepo.findOneBy.mockResolvedValueOnce(null);
      const status = await service.getMyStatus('t1', 'u1');
      expect(status).toEqual({ subscribed: false, source: null, since: null });
    });
  });

  describe('getSubscriberIds', () => {
    it('maps rows to user ids', async () => {
      mockSubRepo.find.mockResolvedValueOnce([
        { user_id: 'u1' },
        { user_id: 'u2' },
      ]);
      await expect(service.getSubscriberIds('t1')).resolves.toEqual([
        'u1',
        'u2',
      ]);
    });

    it('is resilient: returns [] on repo error', async () => {
      mockSubRepo.find.mockRejectedValueOnce(new Error('db down'));
      await expect(service.getSubscriberIds('t1')).resolves.toEqual([]);
    });
  });

  describe('ensureTaskExists', () => {
    it('throws NotFoundException when the task is missing', async () => {
      mockTaskRepo.existsBy.mockResolvedValueOnce(false);
      await expect(service.ensureTaskExists('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves when the task exists', async () => {
      mockTaskRepo.existsBy.mockResolvedValueOnce(true);
      await expect(service.ensureTaskExists('t1')).resolves.toBeUndefined();
    });
  });
});
