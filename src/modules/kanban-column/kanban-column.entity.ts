import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Task } from '../task/task.entity';
import { Project } from '../project/project.entity';

@Entity('kanban_columns')
export class KanbanColumn {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn('increment')
  id: number;

  @ApiProperty({ example: 'In Progress' })
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @ApiProperty({ example: 2 })
  @Index('idx_kanban_columns_position')
  @Column({ type: 'int', default: 0 })
  position: number;

  @ApiProperty({ example: '#F59E0B', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string;

  @ApiProperty({ example: false })
  @Column({ type: 'boolean', default: false })
  is_archived: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ApiProperty({ example: 'aB3kM9xZ' })
  @Column({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiHideProperty()
  @ManyToOne(() => Project, (project) => project.columns, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ApiHideProperty()
  @OneToMany(() => Task, (task) => task.column)
  tasks: Task[];
}
