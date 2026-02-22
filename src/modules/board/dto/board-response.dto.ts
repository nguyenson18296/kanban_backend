import { ApiProperty } from '@nestjs/swagger';
import { TaskPriority, TaskStatus } from '../../task/task.entity';

export class BoardAssigneeDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  full_name: string;

  @ApiProperty({
    example: 'https://api.dicebear.com/9.x/initials/svg?seed=JD',
  })
  avatar_url: string;
}

export class BoardLabelDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'Bug' })
  name: string;

  @ApiProperty({ example: '#EF4444' })
  color: string;
}

export class BoardTaskDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'Implement login page' })
  title: string;

  @ApiProperty({ example: 'KAN-1' })
  ticket_id: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ enum: TaskStatus, example: TaskStatus.OPEN })
  status: TaskStatus;

  @ApiProperty({ enum: TaskPriority, example: TaskPriority.HIGH })
  priority: TaskPriority;

  @ApiProperty({ example: '2025-01-15T10:30:00.000Z' })
  created_at: Date;

  @ApiProperty({ type: [BoardAssigneeDto] })
  assignees: BoardAssigneeDto[];

  @ApiProperty({ type: [BoardLabelDto] })
  labels: BoardLabelDto[];
}

export class BoardColumnDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'To Do' })
  name: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ example: '#3B82F6', nullable: true })
  color: string;

  @ApiProperty({ example: 12, description: 'Total matching tasks in column' })
  task_count: number;

  @ApiProperty({ type: [BoardTaskDto] })
  tasks: BoardTaskDto[];
}

export class BoardResponseDto {
  @ApiProperty({ type: [BoardColumnDto] })
  columns: BoardColumnDto[];
}
