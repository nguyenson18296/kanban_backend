import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Task } from './task.entity';
import { User } from '../user/user.entity';
import { Label } from '../label/label.entity';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Label)
    private readonly labelRepository: Repository<Label>,
    @InjectRepository(KanbanColumn)
    private readonly columnRepository: Repository<KanbanColumn>,
  ) {}

  async create(dto: CreateTaskDto): Promise<Task> {
    try {
      const { assignee_ids, label_ids, ...taskData } = dto;

      await this.resolveColumn(taskData.column_id);

      const task = this.taskRepository.create(taskData);

      if (assignee_ids?.length) {
        task.assignees = await this.resolveUsers(assignee_ids);
      }

      if (label_ids?.length) {
        task.labels = await this.resolveLabels(label_ids);
      }

      const saved = await this.taskRepository.save(task);

      return this.findOneById(saved.id);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to create task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create task',
        error: (error as Error).message,
      });
    }
  }

  async findAll(): Promise<Task[]> {
    try {
      return await this.taskRepository.find({
        relations: ['assignees', 'labels'],
      });
    } catch (error) {
      this.logger.error('Failed to fetch tasks', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch tasks',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<Task> {
    try {
      const task = await this.taskRepository.findOne({
        where: { id },
        relations: ['assignees', 'labels'],
      });
      if (!task) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Task with id "${id}" not found`,
        });
      }
      return task;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch task',
        error: (error as Error).message,
      });
    }
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    try {
      const task = await this.findOneById(id);
      const { assignee_ids, label_ids, ...taskData } = dto;

      Object.assign(task, taskData);

      if (assignee_ids !== undefined) {
        task.assignees = assignee_ids.length
          ? await this.resolveUsers(assignee_ids)
          : [];
      }

      if (label_ids !== undefined) {
        task.labels = label_ids.length
          ? await this.resolveLabels(label_ids)
          : [];
      }

      await this.taskRepository.save(task);
      return this.findOneById(id);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to update task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update task',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const task = await this.findOneById(id);
      await this.taskRepository.remove(task);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to delete task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete task',
        error: (error as Error).message,
      });
    }
  }

  async addAssignees(taskId: string, userIds: string[]): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      const users = await this.resolveUsers(userIds);
      const existingIds = new Set(task.assignees.map((u) => u.id));
      const newUsers = users.filter((u) => !existingIds.has(u.id));
      task.assignees = [...task.assignees, ...newUsers];
      await this.taskRepository.save(task);
      return this.findOneById(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to add assignees', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add assignees',
        error: (error as Error).message,
      });
    }
  }

  async removeAssignees(taskId: string, userIds: string[]): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      await this.resolveUsers(userIds);
      const removeSet = new Set(userIds);
      task.assignees = task.assignees.filter((u) => !removeSet.has(u.id));
      await this.taskRepository.save(task);
      return this.findOneById(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to remove assignees', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove assignees',
        error: (error as Error).message,
      });
    }
  }

  async addLabels(taskId: string, labelIds: string[]): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      const labels = await this.resolveLabels(labelIds);
      const existingIds = new Set(task.labels.map((l) => l.id));
      const newLabels = labels.filter((l) => !existingIds.has(l.id));
      task.labels = [...task.labels, ...newLabels];
      await this.taskRepository.save(task);
      return this.findOneById(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to add labels', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add labels',
        error: (error as Error).message,
      });
    }
  }

  async removeLabels(taskId: string, labelIds: string[]): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      await this.resolveLabels(labelIds);
      const removeSet = new Set(labelIds);
      task.labels = task.labels.filter((l) => !removeSet.has(l.id));
      await this.taskRepository.save(task);
      return this.findOneById(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to remove labels', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove labels',
        error: (error as Error).message,
      });
    }
  }

  private async resolveUsers(ids: string[]): Promise<User[]> {
    const users = await this.userRepository.findBy({ id: In(ids) });
    if (users.length !== ids.length) {
      const foundIds = new Set(users.map((u) => u.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Users not found: ${missing.join(', ')}`,
      });
    }
    return users;
  }

  private async resolveColumn(id: number): Promise<KanbanColumn> {
    const column = await this.columnRepository.findOneBy({ id });
    if (!column) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Column with id "${id}" not found`,
      });
    }
    return column;
  }

  private async resolveLabels(ids: string[]): Promise<Label[]> {
    const labels = await this.labelRepository.findBy({ id: In(ids) });
    if (labels.length !== ids.length) {
      const foundIds = new Set(labels.map((l) => l.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Labels not found: ${missing.join(', ')}`,
      });
    }
    return labels;
  }
}
