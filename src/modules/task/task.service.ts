import {
  BadRequestException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Task } from './task.entity';
import { User } from '../user/user.entity';
import { Label } from '../label/label.entity';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  NOTIFICATION_EVENTS,
  TaskUpdatedEvent,
} from '../notification/events/notification.events';
import {
  ACTIVITY_EVENTS,
  TaskActivityAction,
  TaskActivityEvent,
} from '../activity/events/activity.events';

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
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async ensureTaskExists(id: string): Promise<void> {
    const exists = await this.taskRepository.existsBy({ id });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${id}" not found`,
      });
    }
  }

  async create(dto: CreateTaskDto, actorId?: string): Promise<Task> {
    try {
      const { assignee_ids, label_ids, ...taskData } = dto;

      if (taskData.parent_id) {
        await this.validateParent(taskData.parent_id);
      }

      await this.resolveColumn(taskData.column_id);

      const task = this.taskRepository.create(taskData);

      if (assignee_ids?.length) {
        task.assignees = await this.resolveUsers(assignee_ids);
      }

      if (label_ids?.length) {
        task.labels = await this.resolveLabels(label_ids);
      }

      const saved = await this.taskRepository.save(task);

      const result = await this.findOneById(saved.id);
      if (actorId) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_CREATED,
          new TaskActivityEvent(
            actorId,
            saved.id,
            TaskActivityAction.TASK_CREATED,
          ),
        );
      }
      return result;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
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
        where: { parent_id: IsNull() },
        relations: [
          'assignees',
          'labels',
          'creator',
          'subtasks',
          'subtasks.parent',
        ],
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

  async findByTicketId(ticketId: string): Promise<Task> {
    try {
      const task = await this.taskRepository.findOne({
        where: { ticket_id: ticketId },
        relations: [
          'assignees',
          'labels',
          'creator',
          'subtasks',
          'subtasks.parent',
          'parent',
        ],
      });
      if (!task) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Task with ticket_id "${ticketId}" not found`,
        });
      }
      return task;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to fetch task by ticket_id',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch task by ticket_id',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<Task> {
    try {
      const task = await this.taskRepository.findOne({
        where: { id },
        relations: [
          'assignees',
          'labels',
          'creator',
          'subtasks',
          'subtasks.parent',
          'parent',
        ],
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

  async update(
    id: string,
    dto: UpdateTaskDto,
    actorId?: string,
  ): Promise<Task> {
    try {
      const task = await this.findOneById(id);
      const { assignee_ids, label_ids, ...taskData } = dto;
      const previousStatus = task.status;
      const originalCreatedBy = task.created_by;
      const previousTitle = task.title;
      const previousDescription = task.description;
      const previousPriority = task.priority;
      const previousDueDate = task.due_date;
      const previousAssignees = [...task.assignees];
      const previousAssigneeIds = new Set(previousAssignees.map((u) => u.id));
      const previousLabels = [...task.labels];
      const previousLabelIds = new Set(previousLabels.map((l) => l.id));

      if (taskData.parent_id !== undefined) {
        if (taskData.parent_id !== null) {
          if (taskData.parent_id === id) {
            throw new BadRequestException({
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'A task cannot be its own parent',
            });
          }
          if (task.subtasks?.length) {
            throw new BadRequestException({
              statusCode: HttpStatus.BAD_REQUEST,
              message:
                'Cannot make a task a subtask when it has its own subtasks (would exceed max depth of 1)',
            });
          }
          await this.validateParent(taskData.parent_id);
        }
      }

      Object.assign(task, taskData);

      let newAssignees: User[] | undefined;
      if (assignee_ids !== undefined) {
        newAssignees = assignee_ids.length
          ? await this.resolveUsers(assignee_ids)
          : [];
        task.assignees = newAssignees;
      }

      let newLabels: Label[] | undefined;
      if (label_ids !== undefined) {
        newLabels = label_ids.length ? await this.resolveLabels(label_ids) : [];
        task.labels = newLabels;
      }

      await this.taskRepository.save(task);
      const updated = await this.findOneById(id);

      // Notify task creator when status changes
      if (
        actorId &&
        taskData.status !== undefined &&
        taskData.status !== previousStatus &&
        originalCreatedBy
      ) {
        this.eventEmitter.emit(
          NOTIFICATION_EVENTS.TASK_UPDATED,
          new TaskUpdatedEvent(actorId, task.id, [originalCreatedBy], {
            task_id: task.id,
            task_title: task.title,
            ticket_id: task.ticket_id,
            changes: {
              status: { from: previousStatus, to: taskData.status },
            },
          }),
        );
      }

      // Emit activity events for changed fields
      if (actorId) {
        if (taskData.title !== undefined && taskData.title !== previousTitle) {
          this.eventEmitter.emit(
            ACTIVITY_EVENTS.TASK_TITLE_UPDATED,
            new TaskActivityEvent(
              actorId,
              task.id,
              TaskActivityAction.TASK_TITLE_UPDATED,
            ),
          );
        }
        if (
          taskData.description !== undefined &&
          taskData.description !== previousDescription
        ) {
          this.eventEmitter.emit(
            ACTIVITY_EVENTS.TASK_DESCRIPTION_UPDATED,
            new TaskActivityEvent(
              actorId,
              task.id,
              TaskActivityAction.TASK_DESCRIPTION_UPDATED,
            ),
          );
        }
        if (
          taskData.status !== undefined &&
          taskData.status !== previousStatus
        ) {
          this.eventEmitter.emit(
            ACTIVITY_EVENTS.TASK_STATUS_CHANGED,
            new TaskActivityEvent(
              actorId,
              task.id,
              TaskActivityAction.TASK_STATUS_CHANGED,
              { from: previousStatus, to: taskData.status },
            ),
          );
        }
        if (
          taskData.priority !== undefined &&
          taskData.priority !== previousPriority
        ) {
          this.eventEmitter.emit(
            ACTIVITY_EVENTS.TASK_PRIORITY_CHANGED,
            new TaskActivityEvent(
              actorId,
              task.id,
              TaskActivityAction.TASK_PRIORITY_CHANGED,
              { from: previousPriority, to: taskData.priority },
            ),
          );
        }
        if (taskData.due_date !== undefined) {
          const prevTime = previousDueDate
            ? new Date(previousDueDate).getTime()
            : null;
          const newTime = taskData.due_date
            ? new Date(taskData.due_date).getTime()
            : null;
          if (prevTime !== newTime) {
            this.eventEmitter.emit(
              ACTIVITY_EVENTS.TASK_DUE_DATE_CHANGED,
              new TaskActivityEvent(
                actorId,
                task.id,
                TaskActivityAction.TASK_DUE_DATE_CHANGED,
                {
                  from: previousDueDate
                    ? new Date(previousDueDate).toISOString()
                    : null,
                  to: taskData.due_date
                    ? new Date(taskData.due_date).toISOString()
                    : null,
                },
              ),
            );
          }
        }

        // Emit activity events for assignee changes via update()
        if (newAssignees !== undefined) {
          const newAssigneeIds = new Set(newAssignees.map((u) => u.id));
          const addedUsers = newAssignees.filter(
            (u) => !previousAssigneeIds.has(u.id),
          );
          const removedUsers = previousAssignees.filter(
            (u) => !newAssigneeIds.has(u.id),
          );
          if (addedUsers.length > 0) {
            this.eventEmitter.emit(
              ACTIVITY_EVENTS.TASK_ASSIGNEE_ADDED,
              new TaskActivityEvent(
                actorId,
                task.id,
                TaskActivityAction.TASK_ASSIGNEE_ADDED,
                {
                  users: addedUsers.map((u) => ({
                    user_id: u.id,
                    full_name: u.full_name,
                  })),
                },
              ),
            );
          }
          if (removedUsers.length > 0) {
            this.eventEmitter.emit(
              ACTIVITY_EVENTS.TASK_ASSIGNEE_REMOVED,
              new TaskActivityEvent(
                actorId,
                task.id,
                TaskActivityAction.TASK_ASSIGNEE_REMOVED,
                {
                  users: removedUsers.map((u) => ({
                    user_id: u.id,
                    full_name: u.full_name,
                  })),
                },
              ),
            );
          }
        }

        // Emit activity events for label changes via update()
        if (newLabels !== undefined) {
          const newLabelIds = new Set(newLabels.map((l) => l.id));
          const addedLabels = newLabels.filter(
            (l) => !previousLabelIds.has(l.id),
          );
          const removedLabels = previousLabels.filter(
            (l) => !newLabelIds.has(l.id),
          );
          if (addedLabels.length > 0) {
            this.eventEmitter.emit(
              ACTIVITY_EVENTS.TASK_LABEL_ADDED,
              new TaskActivityEvent(
                actorId,
                task.id,
                TaskActivityAction.TASK_LABEL_ADDED,
                {
                  labels: addedLabels.map((l) => ({
                    label_id: l.id,
                    label_name: l.name,
                    color: l.color,
                  })),
                },
              ),
            );
          }
          if (removedLabels.length > 0) {
            this.eventEmitter.emit(
              ACTIVITY_EVENTS.TASK_LABEL_REMOVED,
              new TaskActivityEvent(
                actorId,
                task.id,
                TaskActivityAction.TASK_LABEL_REMOVED,
                {
                  labels: removedLabels.map((l) => ({
                    label_id: l.id,
                    label_name: l.name,
                  })),
                },
              ),
            );
          }
        }
      }

      return updated;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
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

  async addAssignees(
    taskId: string,
    userIds: string[],
    actorId?: string,
  ): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      const users = await this.resolveUsers(userIds);
      const existingIds = new Set(task.assignees.map((u) => u.id));
      const newUsers = users.filter((u) => !existingIds.has(u.id));
      task.assignees = [...task.assignees, ...newUsers];
      await this.taskRepository.save(task);
      const result = await this.findOneById(taskId);
      if (actorId && newUsers.length > 0) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_ASSIGNEE_ADDED,
          new TaskActivityEvent(
            actorId,
            taskId,
            TaskActivityAction.TASK_ASSIGNEE_ADDED,
            {
              users: newUsers.map((u) => ({
                user_id: u.id,
                full_name: u.full_name,
              })),
            },
          ),
        );
      }
      return result;
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

  async removeAssignees(
    taskId: string,
    userIds: string[],
    actorId?: string,
  ): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      await this.resolveUsers(userIds);
      const removeSet = new Set(userIds);
      const removedUsers = task.assignees.filter((u) => removeSet.has(u.id));
      task.assignees = task.assignees.filter((u) => !removeSet.has(u.id));
      await this.taskRepository.save(task);
      const result = await this.findOneById(taskId);
      if (actorId && removedUsers.length > 0) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_ASSIGNEE_REMOVED,
          new TaskActivityEvent(
            actorId,
            taskId,
            TaskActivityAction.TASK_ASSIGNEE_REMOVED,
            {
              users: removedUsers.map((u) => ({
                user_id: u.id,
                full_name: u.full_name,
              })),
            },
          ),
        );
      }
      return result;
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

  async addLabels(
    taskId: string,
    labelIds: number[],
    actorId?: string,
  ): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      const labels = await this.resolveLabels(labelIds);
      const existingIds = new Set(task.labels.map((l) => l.id));
      const newLabels = labels.filter((l) => !existingIds.has(l.id));
      task.labels = [...task.labels, ...newLabels];
      await this.taskRepository.save(task);
      const result = await this.findOneById(taskId);
      if (actorId && newLabels.length > 0) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_LABEL_ADDED,
          new TaskActivityEvent(
            actorId,
            taskId,
            TaskActivityAction.TASK_LABEL_ADDED,
            {
              labels: newLabels.map((l) => ({
                label_id: l.id,
                label_name: l.name,
              })),
            },
          ),
        );
      }
      return result;
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

  async removeLabels(
    taskId: string,
    labelIds: number[],
    actorId?: string,
  ): Promise<Task> {
    try {
      const task = await this.findOneById(taskId);
      await this.resolveLabels(labelIds);
      const removeSet = new Set(labelIds);
      const removedLabels = task.labels.filter((l) => removeSet.has(l.id));
      task.labels = task.labels.filter((l) => !removeSet.has(l.id));
      await this.taskRepository.save(task);
      const result = await this.findOneById(taskId);
      if (actorId && removedLabels.length > 0) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_LABEL_REMOVED,
          new TaskActivityEvent(
            actorId,
            taskId,
            TaskActivityAction.TASK_LABEL_REMOVED,
            {
              labels: removedLabels.map((l) => ({
                label_id: l.id,
                label_name: l.name,
              })),
            },
          ),
        );
      }
      return result;
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

  async reorder(id: string, position: number, actorId?: string): Promise<Task> {
    try {
      await this.ensureTaskExists(id);
      // Defined in sql/kanban_tasks.sql (section 8c)
      await this.dataSource.query('SELECT fn_reorder_task($1::uuid, $2::int)', [
        id,
        position,
      ]);
      const result = await this.findOneById(id);
      if (actorId) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_REORDERED,
          new TaskActivityEvent(
            actorId,
            id,
            TaskActivityAction.TASK_REORDERED,
            { position },
          ),
        );
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to reorder task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to reorder task',
        error: (error as Error).message,
      });
    }
  }

  async move(
    id: string,
    columnId: number,
    position: number,
    actorId?: string,
  ): Promise<Task> {
    try {
      const current = await this.taskRepository.findOne({
        where: { id },
        select: ['id', 'column_id'],
      });
      if (!current) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Task with id "${id}" not found`,
        });
      }
      const previousColumnId = current.column_id;
      await this.resolveColumn(columnId);
      // Defined in sql/kanban_tasks.sql (section 8b)
      await this.dataSource.query(
        'SELECT fn_move_task($1::uuid, $2::int, $3::int)',
        [id, columnId, position],
      );
      const result = await this.findOneById(id);
      if (actorId) {
        this.eventEmitter.emit(
          ACTIVITY_EVENTS.TASK_MOVED,
          new TaskActivityEvent(actorId, id, TaskActivityAction.TASK_MOVED, {
            from_column_id: previousColumnId,
            to_column_id: columnId,
            position,
          }),
        );
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to move task', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to move task',
        error: (error as Error).message,
      });
    }
  }

  async reorderSubtask(
    parentId: string,
    subtaskId: string,
    position: number,
  ): Promise<Task> {
    try {
      await this.ensureTaskExists(parentId);
      // Defined in sql/kanban_tasks.sql (section 8d)
      // Atomically validates subtask belongs to parent and reorders
      await this.dataSource.query(
        'SELECT fn_reorder_subtask($1::uuid, $2::uuid, $3::int)',
        [subtaskId, parentId, position],
      );
      return this.findOneById(subtaskId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.logger.error('Failed to reorder subtask', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to reorder subtask',
        error: (error as Error).message,
      });
    }
  }

  async createSubtask(
    parentId: string,
    dto: CreateSubtaskDto,
    actorId?: string,
  ): Promise<Task> {
    try {
      const parent = await this.findOneById(parentId);
      await this.validateParent(parentId);

      const createDto: CreateTaskDto = {
        ...dto,
        column_id: dto.column_id ?? parent.column_id,
        parent_id: parentId,
      };
      return this.create(createDto, actorId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.logger.error('Failed to create subtask', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create subtask',
        error: (error as Error).message,
      });
    }
  }

  async findSubtasks(parentId: string): Promise<{
    data: Task[];
    status: number;
    success: boolean;
    message?: string;
  }> {
    try {
      await this.ensureTaskExists(parentId);
      const subtasks = await this.taskRepository.find({
        where: { parent_id: parentId },
        relations: ['assignees', 'labels', 'creator', 'subtasks', 'parent'],
        order: { position: 'ASC' },
      });
      return {
        data: subtasks,
        status: HttpStatus.OK,
        success: true,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch subtasks', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch subtasks',
        error: (error as Error).message,
      });
    }
  }

  private async validateParent(parentId: string): Promise<void> {
    try {
      const parent = await this.taskRepository.findOne({
        where: { id: parentId },
        select: ['id', 'parent_id'],
      });
      if (!parent) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Parent task with id "${parentId}" not found`,
        });
      }
      if (parent.parent_id) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Cannot create a subtask of a subtask (max depth is 1)',
        });
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.logger.error('Failed to validate parent', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to validate parent',
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

  private async resolveLabels(ids: number[]): Promise<Label[]> {
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
