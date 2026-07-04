/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommentService } from './comment.service';
import { Comment } from './comment.entity';
import { Task } from '../task/task.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { SubscriptionSource } from '../subscription/task-subscription.entity';
import { MentionService } from '../mention/mention.service';
import { NOTIFICATION_EVENTS } from '../notification/events/notification.events';

describe('CommentService (KAN-78 fan-out)', () => {
  let service: CommentService;

  const mockCommentRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const mockTaskRepo = { findOne: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockSubscription = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    subscribeMany: jest.fn().mockResolvedValue(undefined),
    getSubscriberIds: jest.fn(),
  };
  const mockMention = { resolveMentionedUserIds: jest.fn() };

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
        CommentService,
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepo },
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SubscriptionService, useValue: mockSubscription },
        { provide: MentionService, useValue: mockMention },
      ],
    }).compile();

    service = module.get<CommentService>(CommentService);

    mockTaskRepo.findOne.mockResolvedValue({
      id: 't1',
      title: 'T',
      ticket_id: 'KAN-1',
      created_by: 'creator',
    });
    mockCommentRepo.create.mockReturnValue({});
    mockCommentRepo.save.mockResolvedValue({ id: 'c1' });
    mockCommentRepo.findOne.mockResolvedValue({
      id: 'c1',
      author: { id: 'author', full_name: 'Author', avatar_url: null },
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('subscribes the commenter, mentioned users, and fans out to subscribers minus author/mentioned', async () => {
    mockMention.resolveMentionedUserIds.mockResolvedValue(['m1']);
    mockSubscription.getSubscriberIds.mockResolvedValue([
      'author',
      'm1',
      's1',
      's2',
    ]);

    await service.create('t1', 'author', { content: 'hi @m1' } as any);

    // commenter auto-subscribed as COMMENTED
    expect(mockSubscription.subscribe).toHaveBeenCalledWith(
      't1',
      'author',
      SubscriptionSource.COMMENTED,
    );
    // mentioned users auto-subscribed as MENTIONED
    expect(mockSubscription.subscribeMany).toHaveBeenCalledWith(
      't1',
      ['m1'],
      SubscriptionSource.MENTIONED,
    );

    // COMMENT_CREATED goes to subscribers minus author minus mentioned
    const created = emittedOf(NOTIFICATION_EVENTS.COMMENT_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0].recipient_ids).toEqual(['s1', 's2']);

    // COMMENT_MENTIONED goes to mentioned users only
    const mentioned = emittedOf(NOTIFICATION_EVENTS.COMMENT_MENTIONED);
    expect(mentioned).toHaveLength(1);
    expect(mentioned[0].recipient_ids).toEqual(['m1']);
  });

  it('does not emit COMMENT_CREATED when the recipient set is empty', async () => {
    mockMention.resolveMentionedUserIds.mockResolvedValue([]);
    mockSubscription.getSubscriberIds.mockResolvedValue(['author']);

    await service.create('t1', 'author', { content: 'solo note' } as any);

    expect(emittedOf(NOTIFICATION_EVENTS.COMMENT_CREATED)).toHaveLength(0);
    expect(emittedOf(NOTIFICATION_EVENTS.COMMENT_MENTIONED)).toHaveLength(0);
  });

  it('still creates the comment when mention resolution fails (resilient)', async () => {
    mockMention.resolveMentionedUserIds.mockRejectedValue(
      new Error('mention lookup down'),
    );
    mockSubscription.getSubscriberIds.mockResolvedValue(['author', 's1']);

    const result = await service.create('t1', 'author', {
      content: 'hi @someone',
    } as any);

    // Comment is returned successfully — no 500 despite the mention failure.
    expect(result).toEqual(expect.objectContaining({ id: 'c1' }));
    // No mention notification, but the comment fan-out to subscribers still runs.
    expect(emittedOf(NOTIFICATION_EVENTS.COMMENT_MENTIONED)).toHaveLength(0);
    const created = emittedOf(NOTIFICATION_EVENTS.COMMENT_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0].recipient_ids).toEqual(['s1']);
  });
});
