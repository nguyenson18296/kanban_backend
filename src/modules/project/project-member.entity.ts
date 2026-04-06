import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Project } from './project.entity';

@Entity('project_members')
export class ProjectMember {
  @ApiProperty({ example: 'aB3kM9xZ' })
  @PrimaryColumn({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Project, (project) => project.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ApiProperty({ example: '2026-04-06T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;
}
