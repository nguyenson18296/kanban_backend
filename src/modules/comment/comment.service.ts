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
import { User } from '../user/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentQueryDto } from './dto/comment-query.dto';
import {
  NOTIFICATION_EVENTS,
  CommentCreatedEvent,
  CommentMentionedEvent,
} from '../notification/events/notification.events';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly eventEmitter: EventEmitter2,
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

      // Notify the task creator that someone commented on their task
      const preview = dto.content.replace(/<[^>]*>/g, '').slice(0, 120);
      if (task.created_by) {
        this.eventEmitter.emit(
          NOTIFICATION_EVENTS.COMMENT_CREATED,
          new CommentCreatedEvent(authorId, taskId, task.created_by, {
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

      // Notify @mentioned users (excluding the author and the task creator
      // who already receives a comment_created notification)
      const mentions = this.parseMentions(dto.content);
      if (mentions.ids.length > 0 || mentions.names.length > 0) {
        const excludeIds = [authorId];
        if (task.created_by) excludeIds.push(task.created_by);

        const mentionedUserIds = await this.resolveMentionedUsers(
          mentions,
          excludeIds,
        );

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
  ): Promise<{
    data: Comment[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
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

  /**
   * Extract @mentioned users from HTML content.
   * Returns { ids, names } — UUIDs from data-mention-id (preferred),
   * full_names from data-mention or plain @Name as fallback.
   */
  private parseMentions(html: string): { ids: string[]; names: string[] } {
    const ids = new Set<string>();
    const names = new Set<string>();
    let match: RegExpExecArray | null;

    // Prefer data-mention-id (UUID) when available
    const idRegex = /data-mention-id="([^"]+)"/g;

    // Collect all mention-id UUIDs
    while ((match = idRegex.exec(html)) !== null) {
      ids.add(match[1].trim());
    }

    // Collect data-mention names only for tags WITHOUT a data-mention-id
    // Re-parse each mention span to check if it has an id sibling
    const spanRegex = /<span[^>]*data-mention="([^"]+)"[^>]*>/g;
    while ((match = spanRegex.exec(html)) !== null) {
      const spanTag = match[0];
      if (!spanTag.includes('data-mention-id')) {
        names.add(match[1].trim());
      }
    }

    // Fallback: plain @Name patterns from text content (no rich text editor)
    const plainText = html.replaceAll(/<[^>]*>/g, ' ');
    const plainMentionRegex = /@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)/g;
    while ((match = plainMentionRegex.exec(plainText)) !== null) {
      names.add(match[1].trim());
    }

    return { ids: [...ids], names: [...names] };
  }

  /**
   * Resolve mentioned users to IDs, excluding specific user IDs
   * (e.g., the comment author and the task creator who already gets notified).
   * Accepts both direct UUIDs and full_names to resolve.
   */
  private async resolveMentionedUsers(
    mentions: { ids: string[]; names: string[] },
    excludeIds: string[],
  ): Promise<string[]> {
    const resolvedIds = new Set<string>();
    const excludeSet = new Set(excludeIds);

    // Direct UUIDs — verify they exist and are active
    if (mentions.ids.length > 0) {
      const usersById = await this.userRepository
        .createQueryBuilder('user')
        .select('user.id')
        .where('user.id IN (:...ids)', { ids: mentions.ids })
        .andWhere('user.is_active = true')
        .getMany();

      for (const u of usersById) {
        if (!excludeSet.has(u.id)) resolvedIds.add(u.id);
      }
    }

    // Name-based fallback — resolve full_name to ID
    if (mentions.names.length > 0) {
      const usersByName = await this.userRepository
        .createQueryBuilder('user')
        .select('user.id')
        .where('user.full_name IN (:...names)', { names: mentions.names })
        .andWhere('user.is_active = true')
        .getMany();

      for (const u of usersByName) {
        if (!excludeSet.has(u.id)) resolvedIds.add(u.id);
      }
    }

    return [...resolvedIds];
  }
}
