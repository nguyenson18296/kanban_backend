export const NOTIFICATION_EVENTS = {
  COMMENT_CREATED: 'notification.comment.created',
  COMMENT_MENTIONED: 'notification.comment.mentioned',
  TASK_ASSIGNED: 'notification.task.assigned',
  TASK_UPDATED: 'notification.task.updated',
} as const;

interface BaseNotificationEvent {
  actor_id: string;
  entity_type: string;
  entity_id: string;
}

export class CommentCreatedEvent implements BaseNotificationEvent {
  entity_type = 'task' as const;

  constructor(
    public readonly actor_id: string,
    public readonly entity_id: string,
    public readonly recipient_ids: string[],
    public readonly payload: {
      task_id: string;
      task_title: string;
      ticket_id: string | null;
      comment_id: string;
      comment_preview: string;
      author: {
        id: string;
        full_name: string;
        avatar_url: string | null;
      };
    },
  ) {}
}

export class CommentMentionedEvent implements BaseNotificationEvent {
  entity_type = 'comment' as const;

  constructor(
    public readonly actor_id: string,
    public readonly entity_id: string,
    public readonly recipient_ids: string[],
    public readonly payload: {
      task_id: string;
      task_title: string;
      ticket_id: string | null;
      comment_id: string;
      comment_preview: string;
    },
  ) {}
}

export class TaskAssignedEvent implements BaseNotificationEvent {
  entity_type = 'task' as const;

  constructor(
    public readonly actor_id: string,
    public readonly entity_id: string,
    public readonly recipient_ids: string[],
    public readonly payload: {
      task_id: string;
      task_title: string;
      ticket_id: string | null;
    },
  ) {}
}

export class TaskUpdatedEvent implements BaseNotificationEvent {
  entity_type = 'task' as const;

  constructor(
    public readonly actor_id: string,
    public readonly entity_id: string,
    public readonly recipient_ids: string[],
    public readonly payload: {
      task_id: string;
      task_title: string;
      ticket_id: string | null;
      changes: Record<string, { from: any; to: any }>;
    },
  ) {}
}
