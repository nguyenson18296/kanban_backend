import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Task } from '../task/task.entity';
import { User } from '../user/user.entity';

@Entity('task_comments')
export class Comment {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example:
      '<p>This looks good, but we need to fix the <strong>validation</strong>.</p>',
    description: 'HTML content of the comment (sanitized server-side)',
  })
  @Column({ type: 'text' })
  content: string;

  @ApiProperty({ example: false })
  @Column({ type: 'boolean', default: false })
  is_edited: boolean;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @Index('idx_task_comments_task_id')
  @Column({ type: 'uuid' })
  task_id: string;

  @ApiHideProperty()
  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ApiHideProperty()
  @Index('idx_task_comments_author_id')
  @Column({ type: 'uuid' })
  author_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  toJSON() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { author_id, ...rest } = this;
    return rest;
  }
}
