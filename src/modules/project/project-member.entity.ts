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
import { Project } from './project.entity';

export enum ProjectRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export const PROJECT_ROLE_HIERARCHY: Record<ProjectRole, number> = {
  [ProjectRole.OWNER]: 3,
  [ProjectRole.ADMIN]: 2,
  [ProjectRole.MEMBER]: 1,
  [ProjectRole.VIEWER]: 0,
};

@Entity('project_members')
export class ProjectMember {
  @ApiProperty({ example: 'aB3kM9xZ' })
  @PrimaryColumn({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @Index('idx_project_members_user_id')
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @ApiProperty({ enum: ProjectRole, example: ProjectRole.MEMBER })
  @Column({
    type: 'enum',
    enum: ProjectRole,
    enumName: 'project_role',
    default: ProjectRole.MEMBER,
  })
  role: ProjectRole;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Project, (project) => project.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ApiProperty({ example: '2026-04-06T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;
}
