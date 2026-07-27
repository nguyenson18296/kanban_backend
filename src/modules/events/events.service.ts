import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NOTIFICATION_EVENTS,
  CommentCreatedEvent,
  CommentMentionedEvent,
  TaskAssignedEvent,
  TaskUpdatedEvent,
} from '../notification/events/notification.events';
import { EventsGateway } from './events.gateway';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly eventsGateway: EventsGateway) {}

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_CREATED, { async: true })
  handleCommentCreated(event: CommentCreatedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'comment_created',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.COMMENT_MENTIONED, { async: true })
  handleCommentMentioned(event: CommentMentionedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'comment_mentioned',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_ASSIGNED, { async: true })
  handleTaskAssigned(event: TaskAssignedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'task_assigned',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TASK_UPDATED, { async: true })
  handleTaskUpdated(event: TaskUpdatedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'task_updated',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }

  private emitToRecipients(
    recipientIds: string[],
    actorId: string,
    data: Record<string, any>,
  ): void {
    const filtered = recipientIds.filter((id) => id !== actorId);
    for (const recipientId of filtered) {
      this.emitNotification(recipientId, data);
    }
  }

  private emitNotification(
    recipientId: string,
    data: Record<string, any>,
  ): void {
    try {
      this.eventsGateway.emitToUser(recipientId, 'notification:new', {
        ...data,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit notification to user ${recipientId}`,
        (error as Error).stack,
      );
    }
  }
}
