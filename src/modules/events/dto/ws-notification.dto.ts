import { NotificationType } from '../../notification/notification.entity';

export class WsNotificationDto {
  id: string;
  type: NotificationType;
  actorId: string;
  entityType: string;
  entityId: string;
  payload: Record<string, any>;
  createdAt: string;

  static fromNotification(notification: {
    id: string;
    type: NotificationType;
    actor_id: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, any>;
    created_at: Date;
  }): WsNotificationDto {
    const dto = new WsNotificationDto();
    dto.id = notification.id;
    dto.type = notification.type;
    dto.actorId = notification.actor_id;
    dto.entityType = notification.entity_type;
    dto.entityId = notification.entity_id;
    dto.payload = notification.payload;
    dto.createdAt = notification.created_at.toISOString();
    return dto;
  }
}
