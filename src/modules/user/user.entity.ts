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
import { Team } from '../team/team.entity';

export enum UserRole {
  BACKEND_DEVELOPER = 'backend_developer',
  FRONTEND_DEVELOPER = 'frontend_developer',
  FULLSTACK_DEVELOPER = 'fullstack_developer',
  QA = 'qa',
  DEVOPS = 'devops',
  DESIGNER = 'designer',
  PRODUCT_MANAGER = 'product_manager',
  TECH_LEAD = 'tech_lead',
}

@Entity('users')
export class User {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'john@example.com' })
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @ApiProperty({ example: 'John Doe' })
  @Column({ type: 'varchar', length: 150 })
  full_name: string;

  @ApiHideProperty()
  @Column({ type: 'text', select: false })
  password_hash: string;

  @ApiProperty({ enum: UserRole, example: UserRole.BACKEND_DEVELOPER })
  @Index('idx_users_role')
  @Column({ type: 'enum', enum: UserRole, default: UserRole.BACKEND_DEVELOPER })
  role: UserRole;

  @ApiProperty({ example: 1, nullable: true })
  @Index('idx_users_team_id')
  @Column({ type: 'int', nullable: true })
  team_id: number;

  @ApiHideProperty()
  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @ApiProperty({
    example: 'https://api.dicebear.com/9.x/initials/svg?seed=JD',
  })
  @Column({
    type: 'text',
    default: 'https://api.dicebear.com/9.x/initials/svg?seed=default',
  })
  avatar_url: string;

  @ApiProperty({ example: true })
  @Index('idx_users_is_active')
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ApiProperty({ example: '2025-01-01T00:00:00.000Z' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
