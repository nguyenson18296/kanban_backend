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
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 150 })
  full_name: string;

  @Column({ type: 'text', select: false })
  password_hash: string;

  @Index('idx_users_role')
  @Column({ type: 'enum', enum: UserRole, default: UserRole.BACKEND_DEVELOPER })
  role: UserRole;

  @Index('idx_users_team_id')
  @Column({ type: 'int', nullable: true })
  team_id: number;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @Column({
    type: 'text',
    default: 'https://api.dicebear.com/9.x/initials/svg?seed=default',
  })
  avatar_url: string;

  @Index('idx_users_is_active')
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
