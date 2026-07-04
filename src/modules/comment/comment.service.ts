import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { Task } from '../task/task.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentQueryDto } from './dto/comment-query.dto';
import { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import {
  NOTIFICATION_EVENTS,
  CommentCreatedEvent,
  CommentMentionedEvent,
} from '../notification/events/notification.events';
import { SubscriptionService } from '../subscription/subscription.service';
import { SubscriptionSource } from '../subscription/task-subscription.entity';
import { MentionService } from '../mention/mention.service';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    private readonly eventEmitter: EventEmitter2,
    private readonly subscriptionService: SubscriptionService,
    private readonly mentionService: MentionService,
  ) {}

  async create(
    taskId: string,
    authorId: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    try {
      const task = await this.taskRepository.findOne({
        where: { id: taskId },
        select: ['id', 'title', 'ticket_id', 'created_by'],
      });
      if (!task) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Task with id "${taskId}" not found`,
        });
      }

      const comment = this.commentRepository.create({
        content: dto.content,
        task_id: taskId,
        author_id: authorId,
      });

      const saved = await this.commentRepository.save(comment);
      const result = await this.findOneById(saved.id);

      const preview = dto.content.replace(/<[^>]*>/g, '').slice(0, 120);

      // KAN-78: the commenter is auto-subscribed to the task.
      await this.subscriptionService.subscribe(
        taskId,
        authorId,
        SubscriptionSource.COMMENTED,
      );

      // Resolve @mentioned users (exclude only the author — a mentioned task
      // creator should still get a mention notification). Mentioned users are
      // auto-subscribed for future task activity. This runs AFTER the comment
      // is persisted, so mention lookup must never fail the request: on error,
      // fall back to no mentions and still return the created comment.
      let mentionedUserIds: string[] = [];
      try {
        mentionedUserIds = await this.mentionService.resolveMentionedUserIds(
          dto.content,
          [authorId],
        );
        if (mentionedUserIds.length > 0) {
          await this.subscriptionService.subscribeMany(
            taskId,
            mentionedUserIds,
            SubscriptionSource.MENTIONED,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to resolve or subscribe mentions for task ${taskId}`,
          (error as Error).stack,
        );
        mentionedUserIds = [];
      }

      // Fan out COMMENT_CREATED to subscribers, minus the author and anyone
      // already receiving a COMMENT_MENTIONED for this comment (dedupe).
      const subscriberIds =
        await this.subscriptionService.getSubscriberIds(taskId);
      const mentionedSet = new Set(mentionedUserIds);
      const commentRecipients = subscriberIds.filter(
        (id) => id !== authorId && !mentionedSet.has(id),
      );
      if (commentRecipients.length > 0) {
        this.eventEmitter.emit(
          NOTIFICATION_EVENTS.COMMENT_CREATED,
          new CommentCreatedEvent(authorId, taskId, commentRecipients, {
            task_id: taskId,
            task_title: task.title,
            ticket_id: task.ticket_id,
            comment_id: saved.id,
            comment_preview: preview,
            author: {
              id: result.author.id,
              full_name: result.author.full_name,
              avatar_url: result.author.avatar_url,
            },
          }),
        );
      }

      if (mentionedUserIds.length > 0) {
        this.eventEmitter.emit(
          NOTIFICATION_EVENTS.COMMENT_MENTIONED,
          new CommentMentionedEvent(authorId, saved.id, mentionedUserIds, {
            task_id: taskId,
            task_title: task.title,
            ticket_id: task.ticket_id,
            comment_id: saved.id,
            comment_preview: preview,
          }),
        );
      }

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to create comment', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create comment',
        error: (error as Error).message,
      });
    }
  }

  async findByTask(
    taskId: string,
    query: CommentQueryDto,
  ): Promise<PaginatedResponse<Comment>> {
    try {
      await this.ensureTaskExists(taskId);

      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const sort = query.sort ?? 'DESC';

      const [data, total] = await this.commentRepository.findAndCount({
        where: { task_id: taskId },
        relations: ['author'],
        order: { created_at: sort },
        skip: (page - 1) * limit,
        take: limit,
      });

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch comments', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch comments',
        error: (error as Error).message,
      });
    }
  }

  async update(
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ): Promise<Comment> {
    try {
      const comment = await this.findOneById(commentId);
      this.ensureOwnership(comment, userId);

      comment.content = dto.content;
      comment.is_edited = true;

      await this.commentRepository.save(comment);
      return this.findOneById(commentId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.error('Failed to update comment', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update comment',
        error: (error as Error).message,
      });
    }
  }

  async remove(commentId: string, userId: string): Promise<void> {
    try {
      const comment = await this.findOneById(commentId);
      this.ensureOwnership(comment, userId);
      await this.commentRepository.remove(comment);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.error('Failed to delete comment', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete comment',
        error: (error as Error).message,
      });
    }
  }

  private async findOneById(id: string): Promise<Comment> {
    const comment = await this.commentRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!comment) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Comment with id "${id}" not found`,
      });
    }
    return comment;
  }

  private async ensureTaskExists(taskId: string): Promise<void> {
    const exists = await this.taskRepository.existsBy({ id: taskId });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${taskId}" not found`,
      });
    }
  }

  private ensureOwnership(comment: Comment, userId: string): void {
    if (comment.author_id !== userId) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'You can only modify your own comments',
      });
    }
  }
}
