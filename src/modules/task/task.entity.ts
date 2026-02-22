import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Generated,
  Index,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { Team } from '../team/team.entity';
import { User } from '../user/user.entity';
import { Label } from '../label/label.entity';

export enum TaskStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW = 'in_review',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum TaskPriority {
  NO_PRIORITY = 'no_priority',
  URGENT = 'urgent',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

@Entity('tasks')
export class Task {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Implement login page' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty({
    example: 'Build the login form with validation',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty({ enum: TaskStatus, example: TaskStatus.OPEN })
  @Index('idx_tasks_status')
  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.OPEN })
  status: TaskStatus;

  @ApiProperty({ enum: TaskPriority, example: TaskPriority.MEDIUM })
  @Index('idx_tasks_priority')
  @Column({
    type: 'enum',
    enum: TaskPriority,
    default: TaskPriority.NO_PRIORITY,
  })
  priority: TaskPriority;

  @ApiProperty({ example: 0 })
  @Column({ type: 'int', default: 0 })
  position: number;

  @ApiProperty({ example: 'KAN-1' })
  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  ticket_id: string;

  @ApiHideProperty()
  @Generated('increment')
  @Column({ type: 'int', unique: true })
  ticket_number: number;

  @ApiProperty({ example: 1 })
  @Index('idx_tasks_column_id')
  @Column({ type: 'int' })
  column_id: number;

  @ApiHideProperty()
  @ManyToOne(() => KanbanColumn, (col) => col.tasks, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'column_id' })
  column: KanbanColumn;

  @ApiProperty({ example: 1, nullable: true })
  @Index('idx_tasks_team_id')
  @Column({ type: 'int', nullable: true })
  team_id: number;

  @ApiHideProperty()
  @ManyToOne(() => Team, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nullable: true,
  })
  @Index('idx_tasks_created_by')
  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ApiHideProperty()
  @ManyToMany(() => User)
  @JoinTable({
    name: 'task_assignees',
    joinColumn: { name: 'task_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  assignees: User[];

  @ApiHideProperty()
  @ManyToMany(() => Label, (label) => label.tasks)
  @JoinTable({
    name: 'task_labels',
    joinColumn: { name: 'task_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'label_id', referencedColumnName: 'id' },
  })
  labels: Label[];

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
