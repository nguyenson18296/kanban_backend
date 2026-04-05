export const ACTIVITY_EVENTS = {
  TASK_CREATED: 'activity.task.created',
  TASK_TITLE_UPDATED: 'activity.task.title_updated',
  TASK_DESCRIPTION_UPDATED: 'activity.task.description_updated',
  TASK_STATUS_CHANGED: 'activity.task.status_changed',
  TASK_PRIORITY_CHANGED: 'activity.task.priority_changed',
  TASK_DUE_DATE_CHANGED: 'activity.task.due_date_changed',
  TASK_ASSIGNEE_ADDED: 'activity.task.assignee_added',
  TASK_ASSIGNEE_REMOVED: 'activity.task.assignee_removed',
  TASK_LABEL_ADDED: 'activity.task.label_added',
  TASK_LABEL_REMOVED: 'activity.task.label_removed',
  TASK_MOVED: 'activity.task.moved',
  TASK_REORDERED: 'activity.task.reordered',
} as const;

export enum TaskActivityAction {
  TASK_CREATED = 'task_created',
  TASK_TITLE_UPDATED = 'task_title_updated',
  TASK_DESCRIPTION_UPDATED = 'task_description_updated',
  TASK_STATUS_CHANGED = 'task_status_changed',
  TASK_PRIORITY_CHANGED = 'task_priority_changed',
  TASK_DUE_DATE_CHANGED = 'task_due_date_changed',
  TASK_ASSIGNEE_ADDED = 'task_assignee_added',
  TASK_ASSIGNEE_REMOVED = 'task_assignee_removed',
  TASK_LABEL_ADDED = 'task_label_added',
  TASK_LABEL_REMOVED = 'task_label_removed',
  TASK_MOVED = 'task_moved',
  TASK_REORDERED = 'task_reordered',
}

export class TaskActivityEvent {
  constructor(
    public readonly actor_id: string,
    public readonly task_id: string,
    public readonly action: TaskActivityAction,
    public readonly payload: Record<string, any> = {},
  ) {}
}
