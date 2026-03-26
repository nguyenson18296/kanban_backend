import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { Task } from '../task/task.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentQueryDto } from './dto/comment-query.dto';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  async create(
    taskId: string,
    authorId: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    try {
      await this.ensureTaskExists(taskId);

      const comment = this.commentRepository.create({
        content: dto.content,
        task_id: taskId,
        author_id: authorId,
      });

      const saved = await this.commentRepository.save(comment);
      return this.findOneById(saved.id);
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
}
