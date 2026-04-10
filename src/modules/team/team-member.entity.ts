import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Team } from './team.entity';

@Entity('team_members')
@Unique(['user_id', 'project_id'])
export class TeamMember {
  @ApiProperty({ example: 1 })
  @PrimaryColumn({ type: 'int' })
  team_id: number;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @Index('idx_team_members_user_id')
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @ApiProperty({ example: 'aB3kM9xZ' })
  @Index('idx_team_members_project_id')
  @Column({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiProperty({ type: () => User })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Team, (team) => team.teamMembers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ApiProperty({ example: '2026-04-06T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;
}
