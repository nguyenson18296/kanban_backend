import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Task } from '../task/task.entity';

export enum SubscriptionSource {
  ASSIGNED = 'assigned',
  MENTIONED = 'mentioned',
  COMMENTED = 'commented',
  MANUAL = 'manual',
  CREATED = 'created',
}

@Entity('task_subscriptions')
export class TaskSubscription {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryColumn({ type: 'uuid' })
  task_id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @Index('idx_task_subscriptions_user_id')
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @ApiProperty({ enum: SubscriptionSource, example: SubscriptionSource.MANUAL })
  @Column({
    type: 'enum',
    enum: SubscriptionSource,
    enumName: 'task_subscription_source',
    default: SubscriptionSource.MANUAL,
  })
  source: SubscriptionSource;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ example: '2026-07-03T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
