import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import * as crypto from 'node:crypto';

import { Team } from '../team/team.entity';
import { User } from '../user/user.entity';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';

function generateAlphanumericId(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

@Entity('projects')
export class Project {
  @ApiProperty({ example: 'aB3kM9xZ' })
  @PrimaryColumn({ type: 'varchar', length: 8 })
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = generateAlphanumericId(8);
    }
  }

  @ApiProperty({ example: 'My Kanban Board' })
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @ApiPropertyOptional({ example: 'A project for tracking tasks' })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiPropertyOptional({ example: 1 })
  @Column({ type: 'int', nullable: true })
  team_id: number;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ApiHideProperty()
  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ApiHideProperty()
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ApiHideProperty()
  @OneToMany(() => KanbanColumn, (column) => column.project)
  columns: KanbanColumn[];
}
