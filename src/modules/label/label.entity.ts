import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
} from 'typeorm';
import { Task } from '../task/task.entity';

@Entity('labels')
export class Label {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Bug' })
  @Column({ type: 'varchar', length: 50, unique: true })
  name: string;

  @ApiProperty({ example: '#EF4444' })
  @Column({ type: 'varchar', length: 20 })
  color: string;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ApiHideProperty()
  @ManyToMany(() => Task, (task) => task.labels)
  tasks: Task[];
}
