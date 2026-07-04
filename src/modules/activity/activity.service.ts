import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from './activity.entity';
import { Task } from '../task/task.entity';
import { TaskActivityAction } from './events/activity.events';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { PaginatedResponse } from '../../common/interfaces/pagination.interface';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  async create(data: {
    task_id: string;
    actor_id: string;
    action: TaskActivityAction;
    payload?: Record<string, any>;
  }): Promise<Activity> {
    const activity = this.activityRepository.create({
      task_id: data.task_id,
      actor_id: data.actor_id,
      action: data.action,
      payload: data.payload ?? {},
    });
    return this.activityRepository.save(activity);
  }

  async findByTask(
    taskId: string,
    query: ActivityQueryDto,
  ): Promise<PaginatedResponse<Activity>> {
    try {
      const exists = await this.taskRepository.existsBy({ id: taskId });
      if (!exists) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Task with id "${taskId}" not found`,
        });
      }

      const page = query.page ?? 1;
      const limit = query.limit ?? 20;

      const where: Record<string, any> = { task_id: taskId };
      if (query.action) where.action = query.action;

      const [data, total] = await this.activityRepository.findAndCount({
        where,
        relations: ['actor'],
        order: { created_at: 'ASC' },
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
      this.logger.error(
        'Failed to fetch task activities',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch task activities',
        error: (error as Error).message,
      });
    }
  }
}
