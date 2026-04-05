import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityService } from './activity.service';
import { ACTIVITY_EVENTS, TaskActivityEvent } from './events/activity.events';

@Injectable()
export class ActivityListener {
  private readonly logger = new Logger(ActivityListener.name);

  constructor(private readonly activityService: ActivityService) {}

  @OnEvent(ACTIVITY_EVENTS.TASK_CREATED)
  async handleTaskCreated(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.created');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_TITLE_UPDATED)
  async handleTitleUpdated(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.title_updated');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_DESCRIPTION_UPDATED)
  async handleDescriptionUpdated(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.description_updated');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_STATUS_CHANGED)
  async handleStatusChanged(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.status_changed');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_PRIORITY_CHANGED)
  async handlePriorityChanged(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.priority_changed');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_DUE_DATE_CHANGED)
  async handleDueDateChanged(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.due_date_changed');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_ASSIGNEE_ADDED)
  async handleAssigneeAdded(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.assignee_added');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_ASSIGNEE_REMOVED)
  async handleAssigneeRemoved(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.assignee_removed');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_LABEL_ADDED)
  async handleLabelAdded(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.label_added');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_LABEL_REMOVED)
  async handleLabelRemoved(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.label_removed');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_MOVED)
  async handleTaskMoved(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.moved');
  }

  @OnEvent(ACTIVITY_EVENTS.TASK_REORDERED)
  async handleTaskReordered(event: TaskActivityEvent): Promise<void> {
    await this.handle(event, 'task.reordered');
  }

  private async handle(
    event: TaskActivityEvent,
    eventName: string,
  ): Promise<void> {
    try {
      await this.activityService.create({
        task_id: event.task_id,
        actor_id: event.actor_id,
        action: event.action,
        payload: event.payload,
      });
    } catch (error) {
      this.logger.error(
        `Failed to handle activity.${eventName} event`,
        (error as Error).stack,
      );
    }
  }
}
