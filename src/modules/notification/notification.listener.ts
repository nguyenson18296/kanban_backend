import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { NotificationType } from './notification.entity';
import {
  NOTIFICATION_EVENTS,
  CommentCreatedEvent,
  CommentMentionedEvent,
  TaskAssignedEvent,
  TaskUpdatedEvent,
} from './events/notification.events';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_CREATED)
  async handleCommentCreated(event: CommentCreatedEvent): Promise<void> {
    try {
      await this.notificationService.create({
        type: NotificationType.COMMENT_CREATED,
        recipient_id: event.recipient_id,
        actor_id: event.actor_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        payload: event.payload,
      });
    } catch (error) {
      this.logger.error(
        'Failed to handle comment.created event',
        (error as Error).stack,
      );
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_MENTIONED)
  async handleCommentMentioned(event: CommentMentionedEvent): Promise<void> {
    try {
      const notifications = event.recipient_ids.map((recipientId) => ({
        type: NotificationType.COMMENT_MENTIONED as NotificationType,
        recipient_id: recipientId,
        actor_id: event.actor_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        payload: event.payload,
      }));
      await this.notificationService.createBatch(notifications);
    } catch (error) {
      this.logger.error(
        'Failed to handle comment.mentioned event',
        (error as Error).stack,
      );
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_ASSIGNED)
  async handleTaskAssigned(event: TaskAssignedEvent): Promise<void> {
    try {
      const notifications = event.recipient_ids.map((recipientId) => ({
        type: NotificationType.TASK_ASSIGNED as NotificationType,
        recipient_id: recipientId,
        actor_id: event.actor_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        payload: event.payload,
      }));
      await this.notificationService.createBatch(notifications);
    } catch (error) {
      this.logger.error(
        'Failed to handle task.assigned event',
        (error as Error).stack,
      );
    }
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_UPDATED)
  async handleTaskUpdated(event: TaskUpdatedEvent): Promise<void> {
    try {
      const notifications = event.recipient_ids.map((recipientId) => ({
        type: NotificationType.TASK_UPDATED as NotificationType,
        recipient_id: recipientId,
        actor_id: event.actor_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        payload: event.payload,
      }));
      await this.notificationService.createBatch(notifications);
    } catch (error) {
      this.logger.error(
        'Failed to handle task.updated event',
        (error as Error).stack,
      );
    }
  }
}
