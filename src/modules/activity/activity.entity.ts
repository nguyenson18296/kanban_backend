import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { TaskActivityAction } from './events/activity.events';

@Entity('task_activities')
export class Activity {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiHideProperty()
  @Index('idx_task_activities_task_id')
  @Column({ type: 'uuid' })
  task_id: string;

  @ApiHideProperty()
  @Index('idx_task_activities_actor_id')
  @Column({ type: 'uuid' })
  actor_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @ApiProperty({
    enum: TaskActivityAction,
    example: TaskActivityAction.TASK_STATUS_CHANGED,
  })
  @Column({
    type: 'enum',
    enum: TaskActivityAction,
    enumName: 'task_activity_action',
  })
  action: TaskActivityAction;

  @ApiProperty({
    example: { from: 'open', to: 'in_progress' },
    description: 'Context-specific payload',
  })
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, any>;

  @ApiProperty({ example: '2026-04-04T10:30:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  toJSON() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { task_id, actor_id, ...rest } = this;
    return rest;
  }
}
