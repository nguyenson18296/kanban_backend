import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Project } from '../project/project.entity';
import { TeamMember } from './team-member.entity';

@Entity('teams')
@Unique('uq_teams_project_name', ['project_id', 'name'])
export class Team {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn('increment')
  id: number;

  @ApiProperty({ example: 'Backend Team' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiPropertyOptional({ example: 'Handles server-side development', nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiPropertyOptional({ example: '#3B82F6', nullable: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string;

  @ApiProperty({ example: true })
  @Index('idx_teams_is_active')
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ApiProperty({ example: 'aB3kM9xZ' })
  @Index('idx_teams_project_id')
  @Column({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiHideProperty()
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ApiHideProperty()
  @OneToMany(() => TeamMember, (tm) => tm.team)
  teamMembers: TeamMember[];

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
