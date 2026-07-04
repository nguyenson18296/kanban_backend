/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskService } from './task.service';
import { Task } from './task.entity';
import { User } from '../user/user.entity';
import { Label } from '../label/label.entity';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { SubscriptionSource } from '../subscription/task-subscription.entity';
import { MentionService } from '../mention/mention.service';
import { NOTIFICATION_EVENTS } from '../notification/events/notification.events';

describe('TaskService (KAN-78 subscriptions)', () => {
  let service: TaskService;

  const mockTaskRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    existsBy: jest.fn(),
  };
  const mockUserRepo = { findBy: jest.fn() };
  const mockLabelRepo = { findBy: jest.fn() };
  const mockColumnRepo = { findOneBy: jest.fn() };
  const mockDataSource = { query: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockSubscription = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    subscribeMany: jest.fn().mockResolvedValue(undefined),
    getSubscriberIds: jest.fn().mockResolvedValue([]),
  };
  const mockMention = {
    resolveMentionedUserIds: jest.fn().mockResolvedValue([]),
  };

  const emittedOf = (name: string) => {
    const calls = mockEventEmitter.emit.mock.calls as [
      string,
      { recipient_ids?: string[] },
    ][];
    return calls.filter((c) => c[0] === name).map((c) => c[1]);
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Label), useValue: mockLabelRepo },
        { provide: getRepositoryToken(KanbanColumn), useValue: mockColumnRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SubscriptionService, useValue: mockSubscription },
        { provide: MentionService, useValue: mockMention },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('auto-subscribes the creator and assignees and notifies assignees', async () => {
      mockColumnRepo.findOneBy.mockResolvedValue({ id: 1 });
      mockUserRepo.findBy.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      mockTaskRepo.create.mockReturnValue({});
      mockTaskRepo.save.mockResolvedValue({ id: 't1' });
      mockTaskRepo.findOne.mockResolvedValue({
        id: 't1',
        title: 'T',
        ticket_id: 'KAN-1',
        assignees: [{ id: 'u1' }, { id: 'u2' }],
        labels: [],
        subtasks: [],
        creator: null,
        parent: null,
      });

      await service.create(
        { column_id: 1, title: 'T', assignee_ids: ['u1', 'u2'] } as any,
        'actor',
      );

      expect(mockSubscription.subscribe).toHaveBeenCalledWith(
        't1',
        'actor',
        SubscriptionSource.CREATED,
      );
      expect(mockSubscription.subscribeMany).toHaveBeenCalledWith(
        't1',
        ['u1', 'u2'],
        SubscriptionSource.ASSIGNED,
      );
      const assigned = emittedOf(NOTIFICATION_EVENTS.TASK_ASSIGNED);
      expect(assigned).toHaveLength(1);
      expect(assigned[0].recipient_ids).toEqual(['u1', 'u2']);
    });
  });

  describe('update (status fan-out)', () => {
    const baseTask = () => ({
      id: 't1',
      title: 'T',
      ticket_id: 'KAN-1',
      status: 'open',
      description: null,
      priority: 'medium',
      due_date: null,
      assignees: [],
      labels: [],
      subtasks: [],
      created_by: 'creator',
    });

    it('fans a status change out to subscribers except the actor', async () => {
      mockTaskRepo.findOne.mockResolvedValue(baseTask());
      mockTaskRepo.save.mockResolvedValue(undefined);
      mockSubscription.getSubscriberIds.mockResolvedValue([
        'creator',
        'actor',
        'watcher',
      ]);

      await service.update('t1', { status: 'done' } as any, 'actor');

      const updated = emittedOf(NOTIFICATION_EVENTS.TASK_UPDATED);
      expect(updated).toHaveLength(1);
      expect(updated[0].recipient_ids).toEqual(['creator', 'watcher']);
    });

    it('does not emit TASK_UPDATED when status is unchanged', async () => {
      mockTaskRepo.findOne.mockResolvedValue(baseTask());
      mockTaskRepo.save.mockResolvedValue(undefined);
      mockSubscription.getSubscriberIds.mockResolvedValue(['creator']);

      await service.update('t1', { title: 'renamed' } as any, 'actor');

      expect(emittedOf(NOTIFICATION_EVENTS.TASK_UPDATED)).toHaveLength(0);
    });
  });

  describe('addAssignees', () => {
    const taskWithNoAssignees = () => ({
      id: 't1',
      title: 'T',
      ticket_id: 'KAN-1',
      assignees: [],
      labels: [],
      subtasks: [],
      creator: null,
      parent: null,
    });

    it('subscribes new assignees and notifies them', async () => {
      mockTaskRepo.findOne.mockResolvedValue(taskWithNoAssignees());
      mockUserRepo.findBy.mockResolvedValue([{ id: 'u1' }]);
      mockTaskRepo.save.mockResolvedValue(undefined);

      await service.addAssignees('t1', ['u1'], 'actor');

      expect(mockSubscription.subscribeMany).toHaveBeenCalledWith(
        't1',
        ['u1'],
        SubscriptionSource.ASSIGNED,
      );
      const assigned = emittedOf(NOTIFICATION_EVENTS.TASK_ASSIGNED);
      expect(assigned).toHaveLength(1);
      expect(assigned[0].recipient_ids).toEqual(['u1']);
    });

    it('subscribes even without an actor, but emits no notification', async () => {
      mockTaskRepo.findOne.mockResolvedValue(taskWithNoAssignees());
      mockUserRepo.findBy.mockResolvedValue([{ id: 'u1' }]);
      mockTaskRepo.save.mockResolvedValue(undefined);

      await service.addAssignees('t1', ['u1']);

      expect(mockSubscription.subscribeMany).toHaveBeenCalledWith(
        't1',
        ['u1'],
        SubscriptionSource.ASSIGNED,
      );
      expect(emittedOf(NOTIFICATION_EVENTS.TASK_ASSIGNED)).toHaveLength(0);
    });
  });

  describe('description-mention resilience', () => {
    it('still creates the task when description mention resolution fails', async () => {
      mockColumnRepo.findOneBy.mockResolvedValue({ id: 1 });
      mockTaskRepo.create.mockReturnValue({});
      mockTaskRepo.save.mockResolvedValue({ id: 't1' });
      mockTaskRepo.findOne.mockResolvedValue({
        id: 't1',
        title: 'T',
        ticket_id: 'KAN-1',
        assignees: [],
        labels: [],
        subtasks: [],
        creator: null,
        parent: null,
      });
      mockMention.resolveMentionedUserIds.mockRejectedValue(
        new Error('mention db down'),
      );

      const result = await service.create(
        { column_id: 1, title: 'T', description: '<p>hi @someone</p>' } as any,
        'actor',
      );

      // Task is returned successfully despite the mention failure (no 500).
      expect(result).toEqual(expect.objectContaining({ id: 't1' }));
      // Creator auto-subscribe still happened (runs before mention resolution).
      expect(mockSubscription.subscribe).toHaveBeenCalledWith(
        't1',
        'actor',
        SubscriptionSource.CREATED,
      );
    });

    it('still updates the task when description mention resolution fails', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 't1',
        title: 'T',
        ticket_id: 'KAN-1',
        status: 'open',
        description: null,
        priority: 'medium',
        due_date: null,
        assignees: [],
        labels: [],
        subtasks: [],
        created_by: 'creator',
      });
      mockTaskRepo.save.mockResolvedValue(undefined);
      mockMention.resolveMentionedUserIds.mockRejectedValue(
        new Error('mention db down'),
      );

      const result = await service.update(
        't1',
        { description: '<p>hi @someone</p>' } as any,
        'actor',
      );

      // Update succeeds despite the mention failure (no 500).
      expect(result).toEqual(expect.objectContaining({ id: 't1' }));
    });
  });
});
