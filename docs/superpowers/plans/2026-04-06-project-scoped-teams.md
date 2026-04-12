# Project-Scoped Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the data model so teams are scoped to projects, users are assigned to projects via a membership table, and team membership is constrained to project members.

**Architecture:** Replace global team assignments (`user.team_id`, `project.team_id`) with three new concepts: `project_members` (users assigned to projects), `team.project_id` (teams scoped to a project), and `team_members` (users assigned to teams within a project). All enforced at the application layer with a DB unique constraint ensuring one team per user per project.

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL, class-validator, class-transformer

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/migrations/1743897600000-restructure-teams-project-scoped.ts` | Schema migration |
| `src/modules/project/project-member.entity.ts` | ProjectMember junction entity |
| `src/modules/project/dto/manage-project-members.dto.ts` | DTO for add/remove members |
| `src/modules/team/team-member.entity.ts` | TeamMember junction entity |
| `src/modules/team/dto/create-team.dto.ts` | DTO for creating a team |
| `src/modules/team/dto/add-team-member.dto.ts` | DTO for adding a team member |

### Modified Files
| File | Changes |
|------|---------|
| `src/modules/project/project.entity.ts` | Remove `team_id`/`team` relation, add `members` OneToMany |
| `src/modules/project/project.service.ts` | Remove team validation, add member management methods |
| `src/modules/project/project.controller.ts` | Add member endpoints |
| `src/modules/project/project.module.ts` | Register new entities |
| `src/modules/project/dto/create-project.dto.ts` | Remove `team_id` field |
| `src/modules/user/user.entity.ts` | Remove `team_id`/`team` relation |
| `src/modules/team/team.entity.ts` | Add `project_id`/`project` relation, replace `members` with `teamMembers` |
| `src/modules/team/team.service.ts` | Rewrite for project-scoped operations |
| `src/modules/team/team.controller.ts` | Move under `/projects/:projectId/teams` |
| `src/modules/team/team.module.ts` | Register new entities |

---

### Task 1: Database Migration

**Files:**
- Create: `src/migrations/1743897600000-restructure-teams-project-scoped.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// src/migrations/1743897600000-restructure-teams-project-scoped.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestructureTeamsProjectScoped1743897600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create project_members table
    await queryRunner.query(`
      CREATE TABLE project_members (
        project_id  VARCHAR(8)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_project_members_user_id ON project_members (user_id)`,
    );

    // 2. Add project_id to teams (nullable first for migration)
    await queryRunner.query(
      `ALTER TABLE teams ADD COLUMN project_id VARCHAR(8) REFERENCES projects(id) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_teams_project_id ON teams (project_id)`,
    );

    // 3. Create team_members table
    await queryRunner.query(`
      CREATE TABLE team_members (
        team_id     INT         NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id  VARCHAR(8)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (team_id, user_id),
        UNIQUE (user_id, project_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_team_members_user_id ON team_members (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_team_members_project_id ON team_members (project_id)`,
    );

    // 4. Migrate existing data: for each user with a team_id,
    //    if the team is linked to a project, create project_member + team_member rows
    //    First, link teams to projects where project.team_id matches
    await queryRunner.query(`
      UPDATE teams t
      SET project_id = p.id
      FROM projects p
      WHERE p.team_id = t.id
    `);

    // Migrate user team memberships into team_members (only where team has a project)
    await queryRunner.query(`
      INSERT INTO team_members (team_id, user_id, project_id)
      SELECT u.team_id, u.id, t.project_id
      FROM users u
      JOIN teams t ON t.id = u.team_id
      WHERE u.team_id IS NOT NULL AND t.project_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    // Also add those users as project members
    await queryRunner.query(`
      INSERT INTO project_members (project_id, user_id)
      SELECT tm.project_id, tm.user_id
      FROM team_members tm
      ON CONFLICT DO NOTHING
    `);

    // 5. Drop old columns
    // Drop unique constraint on teams.name (will be replaced with composite unique)
    await queryRunner.query(`
      ALTER TABLE teams DROP CONSTRAINT IF EXISTS "UQ_48e7d8d1fb0b86afebf1c88b57f"
    `);
    await queryRunner.query(`
      ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_name_key
    `);

    // Add composite unique (project_id, name) — allow same name in different projects
    await queryRunner.query(`
      ALTER TABLE teams ADD CONSTRAINT uq_teams_project_name UNIQUE (project_id, name)
    `);

    // Drop users.team_id
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_team_id`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS team_id`);

    // Drop projects.team_id
    await queryRunner.query(`DROP INDEX IF EXISTS idx_projects_team_id`);
    await queryRunner.query(
      `ALTER TABLE projects DROP CONSTRAINT IF EXISTS fk_projects_team_id`,
    );
    await queryRunner.query(
      `ALTER TABLE projects DROP COLUMN IF EXISTS team_id`,
    );

    // Make teams.project_id NOT NULL now that data is migrated
    // (teams without a project will need to be deleted or assigned)
    await queryRunner.query(`
      DELETE FROM teams WHERE project_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE teams ALTER COLUMN project_id SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore teams.project_id to nullable, then drop
    await queryRunner.query(
      `ALTER TABLE teams ALTER COLUMN project_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE teams DROP CONSTRAINT IF EXISTS uq_teams_project_name`,
    );
    await queryRunner.query(
      `ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name)`,
    );

    // Restore projects.team_id
    await queryRunner.query(
      `ALTER TABLE projects ADD COLUMN team_id INTEGER`,
    );

    // Restore users.team_id
    await queryRunner.query(`ALTER TABLE users ADD COLUMN team_id INTEGER`);
    await queryRunner.query(
      `CREATE INDEX idx_users_team_id ON users (team_id)`,
    );

    // Drop new tables
    await queryRunner.query(`DROP TABLE IF EXISTS team_members`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_members`);

    // Drop teams.project_id
    await queryRunner.query(`DROP INDEX IF EXISTS idx_teams_project_id`);
    await queryRunner.query(
      `ALTER TABLE teams DROP COLUMN IF EXISTS project_id`,
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/migrations/1743897600000-restructure-teams-project-scoped.ts
git commit -m "feat(KAN-72): add migration for project-scoped teams restructure"
```

---

### Task 2: ProjectMember Entity & DTO

**Files:**
- Create: `src/modules/project/project-member.entity.ts`
- Create: `src/modules/project/dto/manage-project-members.dto.ts`

- [ ] **Step 1: Create the ProjectMember entity**

```typescript
// src/modules/project/project-member.entity.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';

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

  @ApiProperty({ example: '2026-04-06T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;
}
```

- [ ] **Step 2: Create the manage members DTO**

```typescript
// src/modules/project/dto/manage-project-members.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ManageProjectMembersDto {
  @ApiProperty({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of user UUIDs to add or remove',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  user_ids: string[];
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/project/project-member.entity.ts src/modules/project/dto/manage-project-members.dto.ts
git commit -m "feat(KAN-72): add ProjectMember entity and ManageProjectMembersDto"
```

---

### Task 3: TeamMember Entity & DTOs

**Files:**
- Create: `src/modules/team/team-member.entity.ts`
- Create: `src/modules/team/dto/create-team.dto.ts`
- Create: `src/modules/team/dto/add-team-member.dto.ts`

- [ ] **Step 1: Create the TeamMember entity**

```typescript
// src/modules/team/team-member.entity.ts
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

@Entity('team_members')
@Unique(['user_id', 'project_id'])
export class TeamMember {
  @ApiProperty({ example: 1 })
  @PrimaryColumn({ type: 'int' })
  team_id: number;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
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

  @ApiProperty({ example: '2026-04-06T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  joined_at: Date;
}
```

- [ ] **Step 2: Create the CreateTeamDto**

```typescript
// src/modules/team/dto/create-team.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: 'Backend Team' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Handles server-side development' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
```

- [ ] **Step 3: Create the AddTeamMemberDto**

```typescript
// src/modules/team/dto/add-team-member.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddTeamMemberDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  user_id: string;
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/team/team-member.entity.ts src/modules/team/dto/create-team.dto.ts src/modules/team/dto/add-team-member.dto.ts
git commit -m "feat(KAN-72): add TeamMember entity, CreateTeamDto, and AddTeamMemberDto"
```

---

### Task 4: Update User Entity — Remove team_id

**Files:**
- Modify: `src/modules/user/user.entity.ts`

- [ ] **Step 1: Remove team-related imports, fields, and relation**

Remove the `Team` import and the `team_id` column + `team` relation from `src/modules/user/user.entity.ts`:

Remove this import:
```typescript
import { Team } from '../team/team.entity';
```

Remove these fields:
```typescript
  @ApiProperty({ example: 1, nullable: true })
  @Index('idx_users_team_id')
  @Column({ type: 'int', nullable: true })
  team_id: number;

  @ApiHideProperty()
  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
```

Also remove unused imports from typeorm: `ManyToOne`, `JoinColumn` (if they're no longer used by other relations in this entity — check first; in this entity they are only used for the team relation, so remove them).

The final imports should be:
```typescript
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/user/user.entity.ts
git commit -m "feat(KAN-72): remove global team_id from User entity"
```

---

### Task 5: Update Team Entity — Add project_id, Replace members

**Files:**
- Modify: `src/modules/team/team.entity.ts`

- [ ] **Step 1: Rewrite the Team entity**

Replace the entire content of `src/modules/team/team.entity.ts` with:

```typescript
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
```

- [ ] **Step 2: Add the inverse relation on TeamMember**

In `src/modules/team/team-member.entity.ts`, add the `team` ManyToOne relation. Add this import and field:

Add import:
```typescript
import { Team } from './team.entity';
```

Add field after the `user` relation:
```typescript
  @ManyToOne(() => Team, (team) => team.teamMembers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/team/team.entity.ts src/modules/team/team-member.entity.ts
git commit -m "feat(KAN-72): make Team project-scoped, replace members with teamMembers"
```

---

### Task 6: Update Project Entity — Remove team_id, Add members

**Files:**
- Modify: `src/modules/project/project.entity.ts`
- Modify: `src/modules/project/dto/create-project.dto.ts`

- [ ] **Step 1: Update Project entity**

In `src/modules/project/project.entity.ts`:

Remove the `Team` import:
```typescript
import { Team } from '../team/team.entity';
```

Add `ProjectMember` import:
```typescript
import { ProjectMember } from './project-member.entity';
```

Remove these fields:
```typescript
  @ApiPropertyOptional({ example: 1 })
  @Column({ type: 'int', nullable: true })
  team_id: number;
```

```typescript
  @ApiPropertyOptional({ type: () => Team, nullable: true })
  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
```

Add this field (after the `creator` relation):
```typescript
  @ApiHideProperty()
  @OneToMany(() => ProjectMember, (pm) => pm.project)
  members: ProjectMember[];
```

Add the inverse relation on ProjectMember. In `src/modules/project/project-member.entity.ts`, add:

Import:
```typescript
import { Project } from './project.entity';
```

Field (after `user` relation):
```typescript
  @ManyToOne(() => Project, (project) => project.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;
```

- [ ] **Step 2: Update CreateProjectDto — remove team_id**

In `src/modules/project/dto/create-project.dto.ts`, remove:
```typescript
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  team_id?: number;
```

Also remove `IsInt` from the class-validator import if no other field uses it.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/project/project.entity.ts src/modules/project/project-member.entity.ts src/modules/project/dto/create-project.dto.ts
git commit -m "feat(KAN-72): remove team_id from Project, add members relation"
```

---

### Task 7: Rewrite ProjectService & ProjectController — Member Management

**Files:**
- Modify: `src/modules/project/project.service.ts`
- Modify: `src/modules/project/project.controller.ts`
- Modify: `src/modules/project/project.module.ts`

- [ ] **Step 1: Update ProjectModule imports**

In `src/modules/project/project.module.ts`, replace the entire file:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { User } from '../user/user.entity';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, User])],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
```

- [ ] **Step 2: Rewrite ProjectService**

Replace the entire content of `src/modules/project/project.service.ts`:

```typescript
import {
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { User } from '../user/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private static readonly MAX_ID_RETRIES = 3;

  private generateBaseTag(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length > 1) {
      return words
        .slice(0, 5)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    }

    const single = words[0] ?? '';
    const tag = single.slice(0, 3).toUpperCase();
    return tag.length >= 2 ? tag : tag.padEnd(2, 'X');
  }

  private async resolveUniqueTag(baseTag: string): Promise<string> {
    const existing = await this.projectRepository.find({
      where: { tag: Like(`${baseTag}%`) },
      select: ['tag'],
    });
    const takenTags = new Set(existing.map((p) => p.tag));

    if (!takenTags.has(baseTag)) return baseTag;

    for (let i = 1; i <= 99; i++) {
      const candidate = `${baseTag}${i}`;
      if (!takenTags.has(candidate)) return candidate;
    }

    throw new InternalServerErrorException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: `Unable to generate unique tag for "${baseTag}"`,
    });
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const baseTag = this.generateBaseTag(dto.name);
    let tag = await this.resolveUniqueTag(baseTag);

    for (let attempt = 0; attempt <= ProjectService.MAX_ID_RETRIES; attempt++) {
      try {
        const project = this.projectRepository.create({ ...dto, tag });
        const saved = await this.projectRepository.save(project);
        return this.findOneById(saved.id);
      } catch (error) {
        if (error.code === '23505') {
          const isPkCollision =
            error.constraint?.includes('pkey') ||
            error.constraint?.startsWith('PK_');

          const isTagCollision = error.constraint?.includes('tag');

          if (
            (isPkCollision || isTagCollision) &&
            attempt < ProjectService.MAX_ID_RETRIES
          ) {
            if (isTagCollision) {
              this.logger.warn(
                `Tag collision on attempt ${attempt + 1}, retrying`,
              );
              tag = await this.resolveUniqueTag(baseTag);
            } else {
              this.logger.warn(
                `Project ID collision on attempt ${attempt + 1}, retrying`,
              );
            }
            continue;
          }

          if (isPkCollision || isTagCollision) {
            this.logger.error(
              `${isPkCollision ? 'Project ID' : 'Tag'} collision persisted after max retries`,
            );
            throw new InternalServerErrorException({
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              message: `Failed to generate unique ${isPkCollision ? 'project ID' : 'tag'}`,
            });
          }

          throw new ConflictException({
            statusCode: HttpStatus.CONFLICT,
            message: `Project with name "${dto.name}" already exists`,
            error: (error as Error).message,
          });
        }
        this.logger.error('Failed to create project', (error as Error).stack);
        throw new InternalServerErrorException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create project',
          error: (error as Error).message,
        });
      }
    }
    throw new InternalServerErrorException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to create project',
    });
  }

  async findAll(): Promise<Project[]> {
    try {
      return await this.projectRepository.find({
        relations: ['creator'],
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch projects', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch projects',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<Project> {
    try {
      const project = await this.projectRepository.findOne({
        where: { id },
        relations: ['creator'],
      });
      if (!project) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Project with id "${id}" not found`,
        });
      }
      return project;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch project',
        error: (error as Error).message,
      });
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    try {
      const project = await this.findOneById(id);
      Object.assign(project, dto);
      await this.projectRepository.save(project);
      return this.findOneById(id);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if (error.code === '23505') {
        const detail: string = error.detail ?? '';
        const match = detail.match(/Key \((\w+)\)=\((.+?)\)/);
        const message = match
          ? `Project with ${match[1]} "${match[2]}" already exists`
          : 'Project unique constraint violation';
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to update project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update project',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const project = await this.findOneById(id);
      await this.projectRepository.remove(project);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error.code === '23503') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'Cannot delete project with existing columns',
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to delete project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete project',
        error: (error as Error).message,
      });
    }
  }

  // --- Project Member Management ---

  async getMembers(projectId: string): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);
      return this.memberRepository.find({
        where: { project_id: projectId },
        relations: ['user'],
        order: { joined_at: 'ASC' },
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch project members', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch project members',
        error: (error as Error).message,
      });
    }
  }

  async addMembers(projectId: string, userIds: string[]): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);
      await this.validateUsers(userIds);

      const existing = await this.memberRepository.findBy({
        project_id: projectId,
        user_id: In(userIds),
      });
      const existingIds = new Set(existing.map((m) => m.user_id));
      const newIds = userIds.filter((id) => !existingIds.has(id));

      if (newIds.length > 0) {
        const members = newIds.map((userId) =>
          this.memberRepository.create({ project_id: projectId, user_id: userId }),
        );
        await this.memberRepository.save(members);
      }

      return this.getMembers(projectId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to add project members', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add project members',
        error: (error as Error).message,
      });
    }
  }

  async removeMembers(projectId: string, userIds: string[]): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);

      // Remove from team_members first (cascade within project)
      // This is handled by the DB cascade since team_members references project_id,
      // but we also need to remove team memberships explicitly since the FK is on team_id not project_id
      await this.memberRepository
        .createQueryBuilder()
        .delete()
        .from('team_members')
        .where('project_id = :projectId AND user_id IN (:...userIds)', {
          projectId,
          userIds,
        })
        .execute();

      // Remove from project_members
      await this.memberRepository.delete({
        project_id: projectId,
        user_id: In(userIds),
      });

      return this.getMembers(projectId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to remove project members', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove project members',
        error: (error as Error).message,
      });
    }
  }

  private async ensureProjectExists(id: string): Promise<void> {
    const exists = await this.projectRepository.existsBy({ id });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Project with id "${id}" not found`,
      });
    }
  }

  private async validateUsers(userIds: string[]): Promise<void> {
    const users = await this.userRepository.findBy({ id: In(userIds) });
    if (users.length !== userIds.length) {
      const foundIds = new Set(users.map((u) => u.id));
      const missing = userIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Users not found: ${missing.join(', ')}`,
      });
    }
  }
}
```

- [ ] **Step 3: Add member endpoints to ProjectController**

In `src/modules/project/project.controller.ts`, add the imports and new endpoints. Replace the entire file:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { ProjectService } from './project.service';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ManageProjectMembersDto } from './dto/manage-project-members.dto';

@ApiTags('Projects')
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({ status: 201, description: 'Project created', type: Project })
  @ApiResponse({ status: 409, description: 'Project name already exists' })
  create(@Body() dto: CreateProjectDto) {
    return this.projectService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all projects' })
  @ApiResponse({ status: 200, description: 'List of projects', type: [Project] })
  findAll() {
    return this.projectService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Project found', type: Project })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.findOneById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Project updated', type: Project })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project name already exists' })
  update(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  remove(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.remove(id);
  }

  // --- Project Members ---

  @Get(':id/members')
  @ApiOperation({ summary: 'Get project members' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of project members' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getMembers(@Param('id', ParseProjectIdPipe) id: string) {
    return this.projectService.getMembers(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add members to a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Members added' })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  addMembers(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: ManageProjectMembersDto,
  ) {
    return this.projectService.addMembers(id, dto.user_ids);
  }

  @Delete(':id/members')
  @ApiOperation({ summary: 'Remove members from a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'Members removed' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  removeMembers(
    @Param('id', ParseProjectIdPipe) id: string,
    @Body() dto: ManageProjectMembersDto,
  ) {
    return this.projectService.removeMembers(id, dto.user_ids);
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/project/project.service.ts src/modules/project/project.controller.ts src/modules/project/project.module.ts
git commit -m "feat(KAN-72): add project member management endpoints"
```

---

### Task 8: Rewrite TeamService & TeamController — Project-Scoped

**Files:**
- Modify: `src/modules/team/team.service.ts`
- Modify: `src/modules/team/team.controller.ts`
- Modify: `src/modules/team/team.module.ts`

- [ ] **Step 1: Update TeamModule imports**

Replace `src/modules/team/team.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './team.entity';
import { TeamMember } from './team-member.entity';
import { Project } from '../project/project.entity';
import { ProjectMember } from '../project/project-member.entity';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Team, TeamMember, Project, ProjectMember])],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
```

- [ ] **Step 2: Rewrite TeamService**

Replace the entire content of `src/modules/team/team.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { TeamMember } from './team-member.entity';
import { Project } from '../project/project.entity';
import { ProjectMember } from '../project/project-member.entity';
import { CreateTeamDto } from './dto/create-team.dto';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
  ) {}

  async create(projectId: string, dto: CreateTeamDto): Promise<Team> {
    try {
      await this.ensureProjectExists(projectId);

      const team = this.teamRepository.create({
        ...dto,
        project_id: projectId,
      });
      const saved = await this.teamRepository.save(team);
      return this.findOneById(projectId, saved.id);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Team "${dto.name}" already exists in this project`,
        });
      }
      this.logger.error('Failed to create team', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create team',
        error: (error as Error).message,
      });
    }
  }

  async findAllByProject(projectId: string): Promise<Team[]> {
    try {
      await this.ensureProjectExists(projectId);
      return this.teamRepository.find({
        where: { project_id: projectId },
        order: { created_at: 'ASC' },
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch teams', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch teams',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(projectId: string, teamId: number): Promise<Team> {
    try {
      const team = await this.teamRepository.findOne({
        where: { id: teamId, project_id: projectId },
      });
      if (!team) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Team with id "${teamId}" not found in project "${projectId}"`,
        });
      }
      return team;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch team', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch team',
        error: (error as Error).message,
      });
    }
  }

  async getMembers(projectId: string, teamId: number): Promise<TeamMember[]> {
    try {
      await this.findOneById(projectId, teamId);
      return this.teamMemberRepository.find({
        where: { team_id: teamId, project_id: projectId },
        relations: ['user'],
        order: { joined_at: 'ASC' },
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch team members', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch team members',
        error: (error as Error).message,
      });
    }
  }

  async addMember(
    projectId: string,
    teamId: number,
    userId: string,
  ): Promise<TeamMember[]> {
    try {
      await this.findOneById(projectId, teamId);

      // Verify user is a project member
      const isProjectMember = await this.projectMemberRepository.existsBy({
        project_id: projectId,
        user_id: userId,
      });
      if (!isProjectMember) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: `User "${userId}" is not a member of project "${projectId}"`,
        });
      }

      // Check if already in this team
      const existing = await this.teamMemberRepository.findOneBy({
        team_id: teamId,
        user_id: userId,
      });
      if (existing) {
        return this.getMembers(projectId, teamId);
      }

      const member = this.teamMemberRepository.create({
        team_id: teamId,
        user_id: userId,
        project_id: projectId,
      });
      await this.teamMemberRepository.save(member);
      return this.getMembers(projectId, teamId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      if (error.code === '23505' && error.constraint?.includes('user_id')) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `User is already assigned to a team in this project`,
        });
      }
      this.logger.error('Failed to add team member', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add team member',
        error: (error as Error).message,
      });
    }
  }

  async removeMember(
    projectId: string,
    teamId: number,
    userId: string,
  ): Promise<TeamMember[]> {
    try {
      await this.findOneById(projectId, teamId);
      await this.teamMemberRepository.delete({
        team_id: teamId,
        user_id: userId,
      });
      return this.getMembers(projectId, teamId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to remove team member', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove team member',
        error: (error as Error).message,
      });
    }
  }

  private async ensureProjectExists(id: string): Promise<void> {
    const exists = await this.projectRepository.existsBy({ id });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Project with id "${id}" not found`,
      });
    }
  }
}
```

- [ ] **Step 3: Rewrite TeamController — nest under /projects/:projectId/teams**

Replace the entire content of `src/modules/team/team.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';

@ApiTags('Project Teams')
@Controller('projects/:projectId/teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @ApiOperation({ summary: 'Create a team in a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Team created' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Team name already exists in project' })
  create(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamService.create(projectId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all teams in a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of teams' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findAll(@Param('projectId', ParseProjectIdPipe) projectId: string) {
    return this.teamService.findAllByProject(projectId);
  }

  @Get(':teamId')
  @ApiOperation({ summary: 'Get a team by ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'Team found' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  findOne(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    return this.teamService.findOneById(projectId, teamId);
  }

  @Get(':teamId/members')
  @ApiOperation({ summary: 'List team members' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 200, description: 'List of team members' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  getMembers(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
  ) {
    return this.teamService.getMembers(projectId, teamId);
  }

  @Post(':teamId/members')
  @ApiOperation({ summary: 'Add a member to a team' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 400, description: 'User is not a project member' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @ApiResponse({ status: 409, description: 'User already in a team in this project' })
  addMember(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamService.addMember(projectId, teamId, dto.user_id);
  }

  @Delete(':teamId/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a team' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'teamId', description: 'Team ID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  removeMember(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.teamService.removeMember(projectId, teamId, userId);
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/team/team.service.ts src/modules/team/team.controller.ts src/modules/team/team.module.ts
git commit -m "feat(KAN-72): rewrite team service and controller for project-scoped teams"
```

---

### Task 9: Clean Up — Remove Old Migration & Verify Build

**Files:**
- Delete: `src/migrations/1743811200000-add-team-id-to-projects.ts` (superseded by new migration)

- [ ] **Step 1: Delete the old migration**

Delete `src/migrations/1743811200000-add-team-id-to-projects.ts` — this migration added `team_id` to projects, which we're now removing.

- [ ] **Step 2: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No new errors (existing warnings OK)

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git rm src/migrations/1743811200000-add-team-id-to-projects.ts
git add -A
git commit -m "feat(KAN-72): clean up old migration, verify build"
```
