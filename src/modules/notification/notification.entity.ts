import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
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

export enum NotificationType {
  COMMENT_CREATED = 'comment_created',
  COMMENT_MENTIONED = 'comment_mentioned',
  TASK_ASSIGNED = 'task_assigned',
  TASK_UPDATED = 'task_updated',
}

@Entity('notifications')
export class Notification {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.COMMENT_CREATED,
  })
  @Index('idx_notifications_type')
  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @ApiHideProperty()
  @Index('idx_notifications_recipient_id')
  @Column({ type: 'uuid' })
  recipient_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_id' })
  recipient: User;

  @ApiHideProperty()
  @Index('idx_notifications_actor_id')
  @Column({ type: 'uuid' })
  actor_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @ApiProperty({ example: 'task', description: 'Type of the related entity' })
  @Column({ type: 'varchar', length: 50 })
  entity_type: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'ID of the related entity',
  })
  @Index('idx_notifications_entity')
  @Column({ type: 'uuid' })
  entity_id: string;

  @ApiProperty({
    example: {
      task_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      task_title: 'Implement login page',
      comment_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      comment_preview: 'This looks good, but...',
      author: {
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        full_name: 'Jane Smith',
        avatar_url: 'https://example.com/avatar.jpg',
      },
    },
    description: 'Dynamic payload with context-specific data',
  })
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, any>;

  @ApiProperty({ example: false })
  @Column({ type: 'boolean', default: false })
  is_read: boolean;

  @ApiProperty({ example: '2026-03-28T12:00:00.000Z', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @ApiProperty({ example: '2026-03-28T10:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  toJSON() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { recipient_id, actor_id, ...rest } = this;
    return rest;
  }
}
