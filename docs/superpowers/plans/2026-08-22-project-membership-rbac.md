# Project Membership & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing project-membership scaffolding into a trustworthy, server-enforced authorization system: a VIEWER role, role management with last-owner protection, hashed invitation tokens with expiry/revocation, a central authorization gate used by every module, membership-scoped queries on every project-scoped route, and authorized Socket.IO board rooms.

**Architecture:** A new `ProjectAccessService` (in the project module) becomes the single authorization gate — it masks non-membership as 404 (anti-enumeration) and insufficient role as 403, and resolves task/column → project for entity-scoped checks. A `ProjectRoleGuard` + `@RequireProjectRole()` decorator centralizes checks for routes with a project id in the path; entity-scoped routes (tasks, comments, subscriptions, activities) call the same service from their services. Invitations are a new feature module with sha256-hashed single-use tokens. The WS gateway gains membership-checked `project:{id}` rooms.

**Tech Stack:** NestJS 11, TypeORM + PostgreSQL (Supabase), Socket.IO, class-validator, Jest with repository mocks, pnpm.

**Spec:** See "Appendix: Source Spec & Design Decisions" at the bottom of this document — the plan argues from it.

## Global Constraints

Copied from `CLAUDE.md` / `.claude/rules/git.md` — every task implicitly includes these:

- **pnpm only** — never npm/yarn. Tests: `pnpm exec jest --testPathPattern=<pattern>`. Build: `pnpm build`. Lint: `pnpm lint`.
- **snake_case everywhere on the wire** — JSON fields, DTO properties, `@Column` names (`token_hash`, `expires_at`, `user_id`). WS event payloads are the known camelCase surface (`projectId`) — follow that only inside `src/modules/events/`.
- **Throw, don't catch in controllers.** Services throw Nest exceptions: 404 `NotFoundException`, 403 `ForbiddenException`, 409 `ConflictException`, 400 `BadRequestException`, 401 `UnauthorizedException`.
- **Never leak internals**: no `error: (error as Error).message` in response bodies. New/rewritten service methods throw directly with generic messages and use `this.logger.error(...)` — do NOT copy the legacy try/catch-with-error-body pattern even when editing next to it.
- **Swagger on everything**: `@ApiTags` per controller, `@ApiOperation` + `@ApiResponse` per route, `@ApiParam` for path params, `@ApiBearerAuth` on guarded routes, `@ApiProperty`/`@ApiPropertyOptional` on every DTO field.
- **Validation only via class-validator DTOs** + the global `ValidationPipe` (whitelist/forbidNonWhitelisted/transform). Never validate request shapes manually.
- **Pipes**: project ids → `ParseProjectIdPipe`, UUIDs → `ParseUUIDPipe`, int ids → `ParseIntPipe`.
- **List responses** use `ApiListResponse<T>` = `{ data, status, success, message? }` (`src/common/interfaces/api-response.interface.ts`).
- **Data access**: `@InjectRepository` + repository API; QueryBuilder only for joins the repository API can't express; multi-row writes that must stay consistent go in `dataSource.transaction(...)`.
- **Logging**: one `private readonly logger = new Logger(ClassName.name)` per service/gateway/listener; no `console.*`.
- **Migrations**: shipped as raw-SQL `MigrationInterface` files in `src/migrations/` (repo convention), even though `synchronize` currently applies schema in dev.
- **Git**: work on `feat/project-rbac` branched off `main` (this repo's integration branch — there is no `develop`). Conventional Commits (`feat(project): ...`). Never commit to `main`. End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Do not push or open a PR without the user's go-ahead.

## Authorization model (canonical — all tasks conform to this)

Roles, ordered: `owner (3) > admin (2) > member (1) > viewer (0)`.

| Action | Minimum role |
|---|---|
| View project, board, tasks, comments, activities, members, teams; subscribe to a task; join WS board room | any membership (`viewer`) |
| Create/update/move/reorder/delete tasks & subtasks; manage assignees/labels on a task; comment | `member` |
| Update project; add members; remove member/viewer members; create/list/revoke invitations (member/viewer); manage teams; manage columns | `admin` |
| Delete project; change roles touching `owner`/`admin` (either direction); remove `owner`/`admin` members; invite as `admin` | `owner` |

Cross-cutting rules:
- **404 masking**: a caller with NO membership in a project gets `404 Project with id "X" not found` from every project-scoped route — never a 403. A member below the required role gets `403 This action requires at least <role> role`.
- **No self role change.** Role changes/removals that would leave zero owners → `409 A project must have at least one owner`. Self-leave (removing exactly yourself) is allowed for any role, subject to the last-owner rule.
- **Invitations**: raw token (64 hex chars) returned exactly once at creation; only the sha256 hash is stored. 7-day expiry. Acceptance requires JWT + the invitee email matching the authed user's email; every invalid-token condition (unknown, expired, revoked, used, wrong email) returns the same generic `400 Invalid or expired invitation`. There is no mailer in this repo — delivery is out-of-band (frontend copies an invite link) plus an in-app notification when the invitee already has an account.
- **Owner cannot be granted by invitation** — only via role change by an existing owner.

---

## Task 0: Branch setup

- [ ] **Step 1: Create the feature branch**

```bash
git -C /Users/sonnguyen/Documents/NodeJS/kanban_backend checkout main
git pull
git checkout -b feat/project-rbac
```

Expected: on branch `feat/project-rbac`, clean tree (`CLAUDE.md` may show as modified from before — leave it unstaged; never sweep it into feature commits).

---

## Task 1: VIEWER role + shared role hierarchy + migration

**Files:**
- Modify: `src/modules/project/project-member.entity.ts` (add enum value, add exported hierarchy)
- Modify: `src/modules/project/project.service.ts:19-23` (delete local `ROLE_HIERARCHY`, import shared one)
- Modify: `src/modules/team/team.service.ts` (delete its duplicated local hierarchy if present; import shared one)
- Create: `src/migrations/1787356800000-add-viewer-to-project-role.ts`

**Interfaces:**
- Produces: `ProjectRole.VIEWER = 'viewer'`; `export const PROJECT_ROLE_HIERARCHY: Record<ProjectRole, number>` in `project-member.entity.ts`. Every later task imports these from `../project/project-member.entity` (or `./project-member.entity` inside the project module).

- [ ] **Step 1: Extend the enum and export the hierarchy**

In `src/modules/project/project-member.entity.ts`, replace the enum block:

```typescript
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
```

- [ ] **Step 2: Delete the private copy in `project.service.ts`**

Remove lines 19–23 (`const ROLE_HIERARCHY = ...`) and change the entity import to:

```typescript
import {
  ProjectMember,
  ProjectRole,
  PROJECT_ROLE_HIERARCHY,
} from './project-member.entity';
```

Then rename the two usages inside `ensureProjectRole` from `ROLE_HIERARCHY[...]` to `PROJECT_ROLE_HIERARCHY[...]`.

Check `src/modules/team/team.service.ts` (it has its own private `ensureProjectRole` around line 231): if it declares its own hierarchy constant, replace it the same way. Its full removal happens in Task 3 — here only make it compile against the shared constant.

- [ ] **Step 3: Write the migration**

Create `src/migrations/1787356800000-add-viewer-to-project-role.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerToProjectRole1787356800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'viewer'`,
    );
  }

  public async down(): Promise<void> {
    // Removing an enum value requires recreating the type and every column
    // using it; not worth it for a down migration. No-op.
  }
}
```

(The enum type is named `project_role` via `enumName` on the entity. `ADD VALUE` inside a transaction is fine on PostgreSQL 12+ / Supabase.)

- [ ] **Step 4: Verify it compiles and existing tests pass**

```bash
pnpm build && pnpm exec jest
```

Expected: build succeeds; all existing suites pass (no behavior changed).

- [ ] **Step 5: Commit**

```bash
git add src/modules/project/project-member.entity.ts src/modules/project/project.service.ts src/modules/team/team.service.ts src/migrations/1787356800000-add-viewer-to-project-role.ts
git commit -m "feat(project): add viewer role and shared role hierarchy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `ProjectAccessService` — the central authorization gate

**Files:**
- Create: `src/modules/project/project-access.service.ts`
- Create: `src/modules/project/project-access.service.spec.ts`
- Modify: `src/modules/project/project.module.ts` (provide + export it)

**Interfaces:**
- Consumes: `ProjectMember`, `ProjectRole`, `PROJECT_ROLE_HIERARCHY` (Task 1).
- Produces (used by every later task):
  - `getMembership(projectId: string, userId: string): Promise<ProjectMember | null>`
  - `ensureRole(projectId: string, userId: string, minimumRole: ProjectRole): Promise<ProjectMember>` — 404 if not a member (masking), 403 if below role, returns the membership.
  - `getProjectIdsForUser(userId: string): Promise<string[]>`
  - `getProjectIdForTask(taskId: string): Promise<string>` — 404 `Task with id "X" not found` if no such task.
  - `getProjectIdForColumn(columnId: number): Promise<string>` — 404 `Column with id "X" not found`.
  - `ensureTaskRole(taskId: string, userId: string, minimumRole: ProjectRole): Promise<string>` — combines the two; returns the project id.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/project/project-access.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectAccessService } from './project-access.service';
import { ProjectMember, ProjectRole } from './project-member.entity';

describe('ProjectAccessService', () => {
  let service: ProjectAccessService;

  const memberRepository = {
    findOneBy: jest.fn(),
    find: jest.fn(),
  };

  const rawQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  const dataSource = {
    createQueryBuilder: jest.fn(() => rawQueryBuilder),
  };

  const membership = (role: ProjectRole): ProjectMember =>
    ({ project_id: 'proj1234', user_id: 'user-1', role }) as ProjectMember;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectAccessService,
        { provide: getRepositoryToken(ProjectMember), useValue: memberRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(ProjectAccessService);
  });

  describe('ensureRole', () => {
    it('throws NotFoundException (masking) when the user is not a member', async () => {
      memberRepository.findOneBy.mockResolvedValue(null);
      await expect(
        service.ensureRole('proj1234', 'user-1', ProjectRole.VIEWER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when the member is below the required role', async () => {
      memberRepository.findOneBy.mockResolvedValue(membership(ProjectRole.VIEWER));
      await expect(
        service.ensureRole('proj1234', 'user-1', ProjectRole.MEMBER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([
      [ProjectRole.VIEWER, ProjectRole.VIEWER],
      [ProjectRole.MEMBER, ProjectRole.MEMBER],
      [ProjectRole.ADMIN, ProjectRole.MEMBER],
      [ProjectRole.OWNER, ProjectRole.ADMIN],
      [ProjectRole.OWNER, ProjectRole.OWNER],
    ])('allows %s when %s is required', async (has, needs) => {
      memberRepository.findOneBy.mockResolvedValue(membership(has));
      await expect(service.ensureRole('proj1234', 'user-1', needs)).resolves.toMatchObject({ role: has });
    });

    it.each([
      [ProjectRole.MEMBER, ProjectRole.ADMIN],
      [ProjectRole.ADMIN, ProjectRole.OWNER],
      [ProjectRole.VIEWER, ProjectRole.OWNER],
    ])('rejects %s when %s is required', async (has, needs) => {
      memberRepository.findOneBy.mockResolvedValue(membership(has));
      await expect(service.ensureRole('proj1234', 'user-1', needs)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getProjectIdForTask', () => {
    it('returns the project id resolved through the task column', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      await expect(service.getProjectIdForTask('task-uuid')).resolves.toBe('proj1234');
    });

    it('throws NotFoundException when the task does not exist', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue(undefined);
      await expect(service.getProjectIdForTask('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getProjectIdsForUser', () => {
    it('returns the project ids of all memberships', async () => {
      memberRepository.find.mockResolvedValue([
        { project_id: 'p1' },
        { project_id: 'p2' },
      ]);
      await expect(service.getProjectIdsForUser('user-1')).resolves.toEqual(['p1', 'p2']);
    });
  });

  describe('ensureTaskRole', () => {
    it('resolves the project then enforces the role, returning the project id', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(membership(ProjectRole.MEMBER));
      await expect(
        service.ensureTaskRole('task-uuid', 'user-1', ProjectRole.MEMBER),
      ).resolves.toBe('proj1234');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec jest --testPathPattern=project-access
```

Expected: FAIL — `Cannot find module './project-access.service'`.

- [ ] **Step 3: Implement the service**

Create `src/modules/project/project-access.service.ts`:

```typescript
import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ProjectMember,
  ProjectRole,
  PROJECT_ROLE_HIERARCHY,
} from './project-member.entity';

/**
 * The single authorization gate for project-scoped resources.
 *
 * Convention: a caller with NO membership gets a 404 that is
 * indistinguishable from a nonexistent project (anti-enumeration).
 * A member below the required role gets a 403.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    private readonly dataSource: DataSource,
  ) {}

  async getMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMember | null> {
    return this.memberRepository.findOneBy({
      project_id: projectId,
      user_id: userId,
    });
  }

  async ensureRole(
    projectId: string,
    userId: string,
    minimumRole: ProjectRole,
  ): Promise<ProjectMember> {
    const membership = await this.getMembership(projectId, userId);
    if (!membership) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Project with id "${projectId}" not found`,
      });
    }
    if (
      PROJECT_ROLE_HIERARCHY[membership.role] <
      PROJECT_ROLE_HIERARCHY[minimumRole]
    ) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: `This action requires at least ${minimumRole} role`,
      });
    }
    return membership;
  }

  async getProjectIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: { user_id: userId },
      select: ['project_id'],
    });
    return memberships.map((m) => m.project_id);
  }

  async getProjectIdForTask(taskId: string): Promise<string> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('col.project_id', 'project_id')
      .from('tasks', 'task')
      .innerJoin('kanban_columns', 'col', 'col.id = task.column_id')
      .where('task.id = :taskId', { taskId })
      .getRawOne<{ project_id: string }>();
    if (!row) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${taskId}" not found`,
      });
    }
    return row.project_id;
  }

  async getProjectIdForColumn(columnId: number): Promise<string> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('col.project_id', 'project_id')
      .from('kanban_columns', 'col')
      .where('col.id = :columnId', { columnId })
      .getRawOne<{ project_id: string }>();
    if (!row) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Column with id "${columnId}" not found`,
      });
    }
    return row.project_id;
  }

  async ensureTaskRole(
    taskId: string,
    userId: string,
    minimumRole: ProjectRole,
  ): Promise<string> {
    const projectId = await this.getProjectIdForTask(taskId);
    await this.ensureRole(projectId, userId, minimumRole);
    return projectId;
  }
}
```

Register it in `src/modules/project/project.module.ts`:

```typescript
import { ProjectAccessService } from './project-access.service';
// ...
@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember, User])],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectAccessService],
  exports: [ProjectService, ProjectAccessService],
})
export class ProjectModule {}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec jest --testPathPattern=project-access && pnpm build
```

Expected: PASS, build green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/project/project-access.service.ts src/modules/project/project-access.service.spec.ts src/modules/project/project.module.ts
git commit -m "feat(project): add ProjectAccessService central authorization gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Rewire existing checks through the gate

**Files:**
- Modify: `src/modules/project/project.service.ts` (delete `ensureProjectRole`, inject `ProjectAccessService`, make `actorId` required in `addMembers`/`removeMembers`)
- Modify: `src/modules/project/project.controller.ts` (no signature change needed — it already passes `userId`)
- Modify: `src/modules/team/team.service.ts` + `src/modules/team/team.module.ts` (delete duplicated private `ensureProjectRole`, inject the shared service, make `actorId` required)

**Interfaces:**
- Consumes: `ProjectAccessService.ensureRole` (Task 2).
- Produces: `ProjectService.addMembers(projectId: string, userIds: string[], actorId: string)` and `removeMembers(projectId, userIds, actorId)` — actor now **required** (optional actor = skipped check = security hole). `TeamService.create/addMember/removeMember` likewise take a required `actorId`.

- [ ] **Step 1: ProjectService**

In `src/modules/project/project.service.ts`:
1. Add constructor param `private readonly projectAccessService: ProjectAccessService,` (import from `./project-access.service`).
2. Delete the whole `ensureProjectRole` method (lines 372–393).
3. In `addMembers` and `removeMembers`, change the signature `actorId?: string` → `actorId: string`, and replace

```typescript
      if (actorId) {
        await this.ensureProjectRole(projectId, actorId, ProjectRole.ADMIN);
      }
```

with

```typescript
      await this.projectAccessService.ensureRole(
        projectId,
        actorId,
        ProjectRole.ADMIN,
      );
```

(Keep `ensureProjectExists` before it for now; the 404 masking makes it redundant but Task 6 rewrites `removeMembers` anyway.)

- [ ] **Step 2: TeamService**

In `src/modules/team/team.service.ts`:
1. `TeamModule` (`src/modules/team/team.module.ts`): add `ProjectModule` to `imports` (`import { ProjectModule } from '../project/project.module';`).
2. Inject `private readonly projectAccessService: ProjectAccessService` into `TeamService`.
3. Delete the private `ensureProjectRole` method (~line 231) and replace its three call sites (lines ~49, ~153, ~210) with `await this.projectAccessService.ensureRole(projectId, actorId, ProjectRole.ADMIN);` — and make each enclosing method's `actorId` parameter required (drop `if (actorId)` wrappers).
4. Update `src/modules/team/team.controller.ts` only if TypeScript now complains (the controller already passes `userId` on mutating routes).

- [ ] **Step 3: Verify no caller passes undefined**

```bash
grep -rn "addMembers\|removeMembers" src --include="*.ts" | grep -v spec
grep -rn "teamService\." src --include="*.ts" | grep -v spec | grep -v team.service
```

Expected: only controller call sites, all passing `userId` from `@CurrentUser('id')`.

- [ ] **Step 4: Build + full test run, commit**

```bash
pnpm build && pnpm exec jest
git add src/modules/project src/modules/team
git commit -m "refactor(project): route all role checks through ProjectAccessService

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `ProjectRoleGuard` + `@RequireProjectRole()` decorator

**Files:**
- Create: `src/modules/project/decorators/require-project-role.decorator.ts`
- Create: `src/modules/project/guards/project-role.guard.ts`
- Create: `src/modules/project/guards/project-role.guard.spec.ts`
- Modify: `src/modules/project/project.module.ts` (provide + export the guard)

**Interfaces:**
- Consumes: `ProjectAccessService.ensureRole` (Task 2).
- Produces: `@RequireProjectRole(role: ProjectRole, param = 'projectId')` route decorator; `ProjectRoleGuard` for `@UseGuards(JwtAuthGuard, ProjectRoleGuard)` (order matters — JWT populates `request.user` first). On success, attaches the membership to `request.projectMembership`. Modules using the guard must import `ProjectModule`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/project/guards/project-role.guard.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ProjectRoleGuard } from './project-role.guard';
import { ProjectAccessService } from '../project-access.service';
import { ProjectRole } from '../project-member.entity';
import { PROJECT_ROLE_KEY } from '../decorators/require-project-role.decorator';

describe('ProjectRoleGuard', () => {
  let guard: ProjectRoleGuard;
  let reflector: Reflector;

  const projectAccessService = { ensureRole: jest.fn() };

  const contextFor = (request: Record<string, any>): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectRoleGuard,
        Reflector,
        { provide: ProjectAccessService, useValue: projectAccessService },
      ],
    }).compile();
    guard = module.get(ProjectRoleGuard);
    reflector = module.get(Reflector);
  });

  it('passes routes with no @RequireProjectRole metadata untouched', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(projectAccessService.ensureRole).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when request.user is missing', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ role: ProjectRole.VIEWER, param: 'projectId' });
    await expect(
      guard.canActivate(contextFor({ params: { projectId: 'proj1234' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforces the role from the named route param and attaches the membership', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ role: ProjectRole.ADMIN, param: 'id' });
    const membership = { role: ProjectRole.OWNER };
    projectAccessService.ensureRole.mockResolvedValue(membership);
    const request: Record<string, any> = {
      user: { id: 'user-1' },
      params: { id: 'proj1234' },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(projectAccessService.ensureRole).toHaveBeenCalledWith(
      'proj1234',
      'user-1',
      ProjectRole.ADMIN,
    );
    expect(request.projectMembership).toBe(membership);
  });

  it('propagates 404/403 from ProjectAccessService', async () => {
    jest
      .spyOn(reflector, 'get')
      .mockReturnValue({ role: ProjectRole.VIEWER, param: 'projectId' });
    const error = new Error('boom');
    projectAccessService.ensureRole.mockRejectedValue(error);
    await expect(
      guard.canActivate(
        contextFor({ user: { id: 'user-1' }, params: { projectId: 'p' } }),
      ),
    ).rejects.toBe(error);
  });

  it('exports the metadata key used by the decorator', () => {
    expect(PROJECT_ROLE_KEY).toBe('project_role');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm exec jest --testPathPattern=project-role.guard
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement decorator and guard**

Create `src/modules/project/decorators/require-project-role.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { ProjectRole } from '../project-member.entity';

export const PROJECT_ROLE_KEY = 'project_role';

export interface ProjectRoleMetadata {
  role: ProjectRole;
  param: string;
}

/**
 * Declares the minimum project role for a route. The project id is read from
 * the route param named `param` (default 'projectId'; pass 'id' when the
 * controller uses :id). Use with @UseGuards(JwtAuthGuard, ProjectRoleGuard).
 */
export const RequireProjectRole = (role: ProjectRole, param = 'projectId') =>
  SetMetadata<string, ProjectRoleMetadata>(PROJECT_ROLE_KEY, { role, param });
```

Create `src/modules/project/guards/project-role.guard.ts`:

```typescript
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectAccessService } from '../project-access.service';
import {
  PROJECT_ROLE_KEY,
  ProjectRoleMetadata,
} from '../decorators/require-project-role.decorator';

@Injectable()
export class ProjectRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectAccessService: ProjectAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<ProjectRoleMetadata | undefined>(
      PROJECT_ROLE_KEY,
      context.getHandler(),
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) {
      // JwtAuthGuard must be listed before this guard.
      throw new UnauthorizedException();
    }
    const projectId: string | undefined = request.params?.[meta.param];
    if (!projectId) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Project not found',
      });
    }
    request.projectMembership = await this.projectAccessService.ensureRole(
      projectId,
      userId,
      meta.role,
    );
    return true;
  }
}
```

In `project.module.ts`, add `ProjectRoleGuard` to both `providers` and `exports`.

- [ ] **Step 4: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern=project-role.guard && pnpm build
git add src/modules/project
git commit -m "feat(project): add ProjectRoleGuard and RequireProjectRole decorator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Member role-change endpoint

**Files:**
- Create: `src/modules/project/dto/update-member-role.dto.ts`
- Modify: `src/modules/project/project.service.ts` (add `changeMemberRole` + `ensureNotLastOwner`)
- Modify: `src/modules/project/project.controller.ts` (add `PATCH :id/members/:userId`)
- Create: `src/modules/project/project.service.spec.ts` (new spec file — the service has none today)

**Interfaces:**
- Consumes: `ProjectAccessService.ensureRole` (returns actor membership), `PROJECT_ROLE_HIERARCHY`.
- Produces: `ProjectService.changeMemberRole(projectId: string, targetUserId: string, newRole: ProjectRole, actorId: string): Promise<ProjectMember>`; `private ensureNotLastOwner(projectId: string, leavingOwnerIds: string[]): Promise<void>` (throws 409) — Task 6 reuses `ensureNotLastOwner`.

Policy (from the canonical model): base gate `admin`; touching `owner`/`admin` in either direction requires `owner`; no self-change (403); demoting the last owner → 409; same-role change is a no-op returning the membership.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/project/project.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectService } from './project.service';
import { ProjectAccessService } from './project-access.service';
import { Project } from './project.entity';
import { ProjectMember, ProjectRole } from './project-member.entity';
import { User } from '../user/user.entity';

describe('ProjectService — member management', () => {
  let service: ProjectService;

  const projectRepository = { findOne: jest.fn(), existsBy: jest.fn() };
  const memberRepository = {
    findOneBy: jest.fn(),
    findBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    countBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const userRepository = { findBy: jest.fn() };
  const projectAccessService = { ensureRole: jest.fn(), getMembership: jest.fn() };

  const manager = {
    createQueryBuilder: jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };

  const member = (userId: string, role: ProjectRole): ProjectMember =>
    ({ project_id: 'proj1234', user_id: userId, role }) as ProjectMember;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: getRepositoryToken(Project), useValue: projectRepository },
        { provide: getRepositoryToken(ProjectMember), useValue: memberRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: DataSource, useValue: dataSource },
        { provide: ProjectAccessService, useValue: projectAccessService },
      ],
    }).compile();
    service = module.get(ProjectService);
  });

  describe('changeMemberRole', () => {
    it('rejects changing your own role', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      await expect(
        service.changeMemberRole('proj1234', 'actor', ProjectRole.ADMIN, 'actor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s when the target is not a member', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      memberRepository.findOneBy.mockResolvedValue(null);
      await expect(
        service.changeMemberRole('proj1234', 'ghost', ProjectRole.MEMBER, 'actor'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets an admin toggle member <-> viewer', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.ADMIN));
      memberRepository.findOneBy.mockResolvedValue(member('target', ProjectRole.MEMBER));
      memberRepository.findOne.mockResolvedValue(member('target', ProjectRole.VIEWER));
      await expect(
        service.changeMemberRole('proj1234', 'target', ProjectRole.VIEWER, 'actor'),
      ).resolves.toMatchObject({ role: ProjectRole.VIEWER });
      expect(memberRepository.save).toHaveBeenCalled();
    });

    it('blocks an admin from promoting to admin (owner-only)', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.ADMIN));
      memberRepository.findOneBy.mockResolvedValue(member('target', ProjectRole.MEMBER));
      await expect(
        service.changeMemberRole('proj1234', 'target', ProjectRole.ADMIN, 'actor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks an admin from demoting an owner', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.ADMIN));
      memberRepository.findOneBy.mockResolvedValue(member('target', ProjectRole.OWNER));
      await expect(
        service.changeMemberRole('proj1234', 'target', ProjectRole.MEMBER, 'actor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409s when demoting the last owner', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      memberRepository.findOneBy.mockResolvedValue(member('target', ProjectRole.OWNER));
      memberRepository.countBy.mockResolvedValue(1);
      await expect(
        service.changeMemberRole('proj1234', 'target', ProjectRole.MEMBER, 'actor'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets an owner promote another member to owner', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      memberRepository.findOneBy.mockResolvedValue(member('target', ProjectRole.MEMBER));
      memberRepository.findOne.mockResolvedValue(member('target', ProjectRole.OWNER));
      await expect(
        service.changeMemberRole('proj1234', 'target', ProjectRole.OWNER, 'actor'),
      ).resolves.toMatchObject({ role: ProjectRole.OWNER });
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm exec jest --testPathPattern=project.service
```

Expected: FAIL — `changeMemberRole` is not a function.

- [ ] **Step 3: Implement DTO, service method, route**

Create `src/modules/project/dto/update-member-role.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProjectRole } from '../project-member.entity';

export class UpdateMemberRoleDto {
  @ApiProperty({
    enum: ProjectRole,
    example: ProjectRole.ADMIN,
    description: 'New role for the member',
  })
  @IsEnum(ProjectRole)
  role: ProjectRole;
}
```

Add to `ProjectService` (after `removeMembers`) — note: no try/catch, throw directly:

```typescript
  async changeMemberRole(
    projectId: string,
    targetUserId: string,
    newRole: ProjectRole,
    actorId: string,
  ): Promise<ProjectMember> {
    const actor = await this.projectAccessService.ensureRole(
      projectId,
      actorId,
      ProjectRole.ADMIN,
    );

    if (actorId === targetUserId) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'You cannot change your own role',
      });
    }

    const target = await this.memberRepository.findOneBy({
      project_id: projectId,
      user_id: targetUserId,
    });
    if (!target) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'User is not a member of this project',
      });
    }

    // Touching owner/admin roles in either direction is owner-only.
    const touchesElevatedRole = [target.role, newRole].some(
      (r) => r === ProjectRole.OWNER || r === ProjectRole.ADMIN,
    );
    const requiredRole = touchesElevatedRole
      ? ProjectRole.OWNER
      : ProjectRole.ADMIN;
    if (
      PROJECT_ROLE_HIERARCHY[actor.role] < PROJECT_ROLE_HIERARCHY[requiredRole]
    ) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: `This action requires at least ${requiredRole} role`,
      });
    }

    if (target.role === ProjectRole.OWNER && newRole !== ProjectRole.OWNER) {
      await this.ensureNotLastOwner(projectId, [targetUserId]);
    }

    if (target.role !== newRole) {
      target.role = newRole;
      await this.memberRepository.save(target);
    }

    const updated = await this.memberRepository.findOne({
      where: { project_id: projectId, user_id: targetUserId },
      relations: ['user'],
    });
    return updated as ProjectMember;
  }

  private async ensureNotLastOwner(
    projectId: string,
    leavingOwnerIds: string[],
  ): Promise<void> {
    const ownersCount = await this.memberRepository.countBy({
      project_id: projectId,
      role: ProjectRole.OWNER,
    });
    if (ownersCount - leavingOwnerIds.length < 1) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'A project must have at least one owner',
      });
    }
  }
```

Add to `ProjectController` (after `removeMembers`; import `ParseUUIDPipe` from `@nestjs/common`, `UpdateMemberRoleDto`, and `ProjectMember` from `./project-member.entity`):

```typescript
  @Patch(':id/members/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change a member's role (admin+; owner for owner/admin changes)",
  })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Member role updated', type: ProjectMember })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project or member not found' })
  @ApiResponse({ status: 409, description: 'Project must keep at least one owner' })
  changeMemberRole(
    @Param('id', ParseProjectIdPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.projectService.changeMemberRole(id, targetUserId, dto.role, actorId);
  }
```

- [ ] **Step 4: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern=project.service && pnpm build
git add src/modules/project
git commit -m "feat(project): add member role-change endpoint with last-owner protection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Member removal protections + self-leave

**Files:**
- Modify: `src/modules/project/project.service.ts` (rewrite `removeMembers`)
- Modify: `src/modules/project/project.service.spec.ts` (add cases)
- Modify: `src/modules/project/project.controller.ts` (Swagger responses only)

**Interfaces:**
- Consumes: `ensureNotLastOwner` (Task 5), `ProjectAccessService.ensureRole`.
- Produces: `removeMembers(projectId: string, userIds: string[], actorId: string): Promise<void>` with: self-leave allowed at any role; removing member/viewer requires `admin`; removing admin/owner requires `owner`; last-owner protected; team_members cleanup and member deletion in one transaction.

- [ ] **Step 1: Add failing tests to `project.service.spec.ts`**

```typescript
  describe('removeMembers', () => {
    it('allows a viewer to remove themselves (self-leave)', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.VIEWER));
      memberRepository.findBy.mockResolvedValue([member('actor', ProjectRole.VIEWER)]);
      await expect(
        service.removeMembers('proj1234', ['actor'], 'actor'),
      ).resolves.toBeUndefined();
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('blocks a member from removing someone else', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.MEMBER));
      memberRepository.findBy.mockResolvedValue([member('victim', ProjectRole.MEMBER)]);
      await expect(
        service.removeMembers('proj1234', ['victim'], 'actor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks an admin from removing another admin (owner-only)', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.ADMIN));
      memberRepository.findBy.mockResolvedValue([member('victim', ProjectRole.ADMIN)]);
      await expect(
        service.removeMembers('proj1234', ['victim'], 'actor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409s when removal would leave zero owners (including self-leave)', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      memberRepository.findBy.mockResolvedValue([member('actor', ProjectRole.OWNER)]);
      memberRepository.countBy.mockResolvedValue(1);
      await expect(
        service.removeMembers('proj1234', ['actor'], 'actor'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets an owner remove an admin', async () => {
      projectAccessService.ensureRole.mockResolvedValue(member('actor', ProjectRole.OWNER));
      memberRepository.findBy.mockResolvedValue([member('victim', ProjectRole.ADMIN)]);
      await expect(
        service.removeMembers('proj1234', ['victim'], 'actor'),
      ).resolves.toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run to verify the new cases fail**

```bash
pnpm exec jest --testPathPattern=project.service
```

Expected: the new `removeMembers` cases FAIL against the old implementation (it requires admin even for self-leave and has no owner protections).

- [ ] **Step 3: Rewrite `removeMembers`**

Replace the whole method in `project.service.ts` (drop the try/catch and `ensureProjectExists` — `ensureRole` 404-masks nonexistent projects):

```typescript
  async removeMembers(
    projectId: string,
    userIds: string[],
    actorId: string,
  ): Promise<void> {
    const actor = await this.projectAccessService.ensureRole(
      projectId,
      actorId,
      ProjectRole.VIEWER,
    );

    const isSelfLeave = userIds.length === 1 && userIds[0] === actorId;
    const targets = await this.memberRepository.findBy({
      project_id: projectId,
      user_id: In(userIds),
    });

    if (!isSelfLeave) {
      const touchesElevatedRole = targets.some(
        (t) => t.role === ProjectRole.OWNER || t.role === ProjectRole.ADMIN,
      );
      const requiredRole = touchesElevatedRole
        ? ProjectRole.OWNER
        : ProjectRole.ADMIN;
      if (
        PROJECT_ROLE_HIERARCHY[actor.role] <
        PROJECT_ROLE_HIERARCHY[requiredRole]
      ) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          message: `This action requires at least ${requiredRole} role`,
        });
      }
    }

    const leavingOwnerIds = targets
      .filter((t) => t.role === ProjectRole.OWNER)
      .map((t) => t.user_id);
    if (leavingOwnerIds.length > 0) {
      await this.ensureNotLastOwner(projectId, leavingOwnerIds);
    }

    await this.dataSource.transaction(async (manager) => {
      // A user leaving the project also leaves any team in it.
      await manager
        .createQueryBuilder()
        .delete()
        .from('team_members')
        .where('project_id = :projectId AND user_id IN (:...userIds)', {
          projectId,
          userIds,
        })
        .execute();
      await manager.delete(ProjectMember, {
        project_id: projectId,
        user_id: In(userIds),
      });
    });
  }
```

Update the `DELETE :id/members` route's Swagger in the controller: add `@ApiResponse({ status: 409, description: 'Project must keep at least one owner' })`.

- [ ] **Step 4: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern=project.service && pnpm build
git add src/modules/project
git commit -m "feat(project): removal protections, self-leave, last-owner guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `ProjectInvitation` entity, migration, module scaffold

**Files:**
- Create: `src/modules/invitation/project-invitation.entity.ts`
- Create: `src/modules/invitation/invitation.module.ts`
- Create: `src/migrations/1787356801000-create-project-invitations.ts`
- Modify: `src/app.module.ts` (import `InvitationModule`)

**Interfaces:**
- Produces: `ProjectInvitation` entity (fields below). Tasks 8–9 build the service/controller in this module.

- [ ] **Step 1: Create the entity**

`src/modules/invitation/project-invitation.entity.ts`:

```typescript
import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../project/project.entity';
import { ProjectRole } from '../project/project-member.entity';
import { User } from '../user/user.entity';

@Entity('project_invitations')
export class ProjectInvitation {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'aB3kM9xZ' })
  @Index('idx_project_invitations_project_id')
  @Column({ type: 'varchar', length: 8 })
  project_id: string;

  @ApiHideProperty()
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ApiProperty({ example: 'jane@example.com' })
  @Index('idx_project_invitations_email')
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @ApiProperty({ enum: ProjectRole, example: ProjectRole.MEMBER })
  @Column({
    type: 'enum',
    enum: ProjectRole,
    enumName: 'project_role',
    default: ProjectRole.MEMBER,
  })
  role: ProjectRole;

  @ApiHideProperty()
  @Index('idx_project_invitations_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, select: false })
  token_hash: string;

  @ApiHideProperty()
  @Column({ type: 'uuid', nullable: true })
  invited_by: string | null;

  @ApiPropertyOptional({ type: () => User, nullable: true })
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by' })
  inviter: User;

  @ApiProperty({ example: '2026-08-29T00:00:00.000Z' })
  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @ApiPropertyOptional({ example: null, nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  @ApiHideProperty()
  @Column({ type: 'uuid', nullable: true })
  accepted_by: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @ApiProperty({ example: '2026-08-22T00:00:00.000Z' })
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  toJSON() {
    // Never serialize the token hash, even if a query selected it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token_hash, invited_by, accepted_by, ...rest } = this;
    return rest;
  }
}
```

- [ ] **Step 2: Create the module scaffold and register it**

`src/modules/invitation/invitation.module.ts` (controller/service are added in Task 8 — start with the entity registration so this commit compiles):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectInvitation } from './project-invitation.entity';
import { ProjectMember } from '../project/project-member.entity';
import { User } from '../user/user.entity';
import { ProjectModule } from '../project/project.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectInvitation, ProjectMember, User]),
    ProjectModule,
  ],
})
export class InvitationModule {}
```

In `src/app.module.ts`, add `InvitationModule` to the `imports` array (`import { InvitationModule } from './modules/invitation/invitation.module';`). Entity auto-discovery (`src/modules/**/*.entity.{ts,js}`) picks up the entity.

- [ ] **Step 3: Write the migration**

`src/migrations/1787356801000-create-project-invitations.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectInvitations1787356801000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE project_invitations (
        id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        project_id  VARCHAR(8)   NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        email       VARCHAR(255) NOT NULL,
        role        project_role NOT NULL DEFAULT 'member',
        token_hash  VARCHAR(64)  NOT NULL,
        invited_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
        expires_at  TIMESTAMPTZ  NOT NULL,
        accepted_at TIMESTAMPTZ,
        accepted_by UUID,
        revoked_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_project_invitations_token_hash ON project_invitations (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_project_invitations_project_id ON project_invitations (project_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_project_invitations_email ON project_invitations (email)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE project_invitations`);
  }
}
```

- [ ] **Step 4: Build, commit**

```bash
pnpm build
git add src/modules/invitation src/migrations/1787356801000-create-project-invitations.ts src/app.module.ts
git commit -m "feat(invitation): add ProjectInvitation entity, migration, module scaffold

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Invitation create / list / revoke

**Files:**
- Create: `src/modules/invitation/dto/create-invitation.dto.ts`
- Create: `src/modules/invitation/invitation.service.ts`
- Create: `src/modules/invitation/invitation.controller.ts`
- Create: `src/modules/invitation/invitation.service.spec.ts`
- Modify: `src/modules/invitation/invitation.module.ts` (register controller + service)

**Interfaces:**
- Consumes: `ProjectAccessService.ensureRole/getMembership`, `ProjectService.findOneById` (both exported by `ProjectModule`).
- Produces:
  - `InvitationService.create(projectId: string, dto: CreateInvitationDto, actorId: string): Promise<Record<string, any>>` — returns `{ ...invitation.toJSON(), token }`; **`token` appears only in this response**.
  - `InvitationService.findPending(projectId: string, actorId: string): Promise<ApiListResponse<ProjectInvitation>>`
  - `InvitationService.revoke(projectId: string, invitationId: string, actorId: string): Promise<void>` (idempotent for already-revoked)
  - `private hashToken(token: string): string` — sha256 hex.
  - Task 9 adds `accept(...)` to this same service and the notification emit inside `create`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/invitation/invitation.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import * as crypto from 'node:crypto';
import { InvitationService } from './invitation.service';
import { ProjectInvitation } from './project-invitation.entity';
import { ProjectMember, ProjectRole } from '../project/project-member.entity';
import { ProjectAccessService } from '../project/project-access.service';
import { ProjectService } from '../project/project.service';
import { User } from '../user/user.entity';

describe('InvitationService', () => {
  let service: InvitationService;

  const invitationRepository = {
    create: jest.fn((v: Partial<ProjectInvitation>) => ({ ...v, toJSON: jest.fn().mockReturnValue(v) })),
    save: jest.fn(async (v: ProjectInvitation) => ({ ...v, id: 'inv-uuid', toJSON: () => ({ id: 'inv-uuid' }) })),
    findOneBy: jest.fn(),
    find: jest.fn(),
  };
  const memberRepository = { findOneBy: jest.fn() };
  const userRepository = { findOneBy: jest.fn() };
  const projectAccessService = { ensureRole: jest.fn(), getMembership: jest.fn() };
  const projectService = { findOneById: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
      cb({ save: jest.fn(), create: jest.fn((_e: unknown, v: unknown) => v) }),
    ),
  };
  const eventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationService,
        { provide: getRepositoryToken(ProjectInvitation), useValue: invitationRepository },
        { provide: getRepositoryToken(ProjectMember), useValue: memberRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: ProjectAccessService, useValue: projectAccessService },
        { provide: ProjectService, useValue: projectService },
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();
    service = module.get(InvitationService);
  });

  describe('create', () => {
    it('requires owner role to invite an admin', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.OWNER });
      userRepository.findOneBy.mockResolvedValue(null);
      invitationRepository.findOneBy.mockResolvedValue(null);
      await service.create('proj1234', { email: 'a@b.com', role: ProjectRole.ADMIN }, 'actor');
      expect(projectAccessService.ensureRole).toHaveBeenCalledWith('proj1234', 'actor', ProjectRole.OWNER);
    });

    it('requires only admin role to invite a member', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      userRepository.findOneBy.mockResolvedValue(null);
      invitationRepository.findOneBy.mockResolvedValue(null);
      await service.create('proj1234', { email: 'a@b.com' }, 'actor');
      expect(projectAccessService.ensureRole).toHaveBeenCalledWith('proj1234', 'actor', ProjectRole.ADMIN);
    });

    it('409s when the invitee is already a member', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      userRepository.findOneBy.mockResolvedValue({ id: 'invitee' });
      projectAccessService.getMembership.mockResolvedValue({ role: ProjectRole.MEMBER });
      await expect(
        service.create('proj1234', { email: 'a@b.com' }, 'actor'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when a pending invitation already exists for the email', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      userRepository.findOneBy.mockResolvedValue(null);
      invitationRepository.findOneBy.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create('proj1234', { email: 'a@b.com' }, 'actor'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('stores only the sha256 hash and returns the raw token once', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      userRepository.findOneBy.mockResolvedValue(null);
      invitationRepository.findOneBy.mockResolvedValue(null);
      const result = await service.create('proj1234', { email: 'A@B.com ' }, 'actor');
      expect(result.token).toHaveLength(64);
      const createdWith = invitationRepository.create.mock.calls[0][0];
      expect(createdWith.token_hash).toBe(
        crypto.createHash('sha256').update(result.token).digest('hex'),
      );
      expect(createdWith.email).toBe('a@b.com'); // trimmed + lowercased
      expect(createdWith.token_hash).not.toBe(result.token);
    });
  });

  describe('revoke', () => {
    it('404s for an unknown invitation in the project', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      invitationRepository.findOneBy.mockResolvedValue(null);
      await expect(service.revoke('proj1234', 'inv-uuid', 'actor')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s when the invitation was already accepted', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      invitationRepository.findOneBy.mockResolvedValue({ accepted_at: new Date(), revoked_at: null });
      await expect(service.revoke('proj1234', 'inv-uuid', 'actor')).rejects.toBeInstanceOf(ConflictException);
    });

    it('sets revoked_at and is idempotent', async () => {
      projectAccessService.ensureRole.mockResolvedValue({ role: ProjectRole.ADMIN });
      const invitation = { accepted_at: null, revoked_at: null } as ProjectInvitation;
      invitationRepository.findOneBy.mockResolvedValue(invitation);
      await service.revoke('proj1234', 'inv-uuid', 'actor');
      expect(invitation.revoked_at).toBeInstanceOf(Date);
      expect(invitationRepository.save).toHaveBeenCalledWith(invitation);
      // second call: already revoked -> no error, no extra save
      invitationRepository.save.mockClear();
      await service.revoke('proj1234', 'inv-uuid', 'actor');
      expect(invitationRepository.save).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm exec jest --testPathPattern=invitation.service
```

Expected: FAIL — `Cannot find module './invitation.service'`.

- [ ] **Step 3: Implement DTO, service, controller**

`src/modules/invitation/dto/create-invitation.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional } from 'class-validator';
import { ProjectRole } from '../../project/project-member.entity';

export class CreateInvitationDto {
  @ApiProperty({ example: 'jane@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    enum: [ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER],
    default: ProjectRole.MEMBER,
    description:
      'Role granted on acceptance. Owner cannot be granted by invitation.',
  })
  @IsOptional()
  @IsIn([ProjectRole.ADMIN, ProjectRole.MEMBER, ProjectRole.VIEWER])
  role?: ProjectRole;
}
```

`src/modules/invitation/invitation.service.ts` (the `accept` method and the notification emit are added in Task 9):

```typescript
import {
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { ProjectInvitation } from './project-invitation.entity';
import { ProjectMember, ProjectRole } from '../project/project-member.entity';
import { ProjectAccessService } from '../project/project-access.service';
import { ProjectService } from '../project/project.service';
import { User } from '../user/user.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ApiListResponse } from '../../common/interfaces/api-response.interface';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @InjectRepository(ProjectInvitation)
    private readonly invitationRepository: Repository<ProjectInvitation>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly projectService: ProjectService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private findPendingByEmail(
    projectId: string,
    email: string,
  ): Promise<ProjectInvitation | null> {
    return this.invitationRepository.findOneBy({
      project_id: projectId,
      email,
      accepted_at: IsNull(),
      revoked_at: IsNull(),
      expires_at: MoreThan(new Date()),
    });
  }

  async create(
    projectId: string,
    dto: CreateInvitationDto,
    actorId: string,
  ): Promise<Record<string, any>> {
    const role = dto.role ?? ProjectRole.MEMBER;
    // Inviting an admin is owner-only; member/viewer invites are admin+.
    const requiredRole =
      role === ProjectRole.ADMIN ? ProjectRole.OWNER : ProjectRole.ADMIN;
    await this.projectAccessService.ensureRole(projectId, actorId, requiredRole);

    const email = dto.email.trim().toLowerCase();

    const invitee = await this.userRepository.findOneBy({ email });
    if (invitee) {
      const membership = await this.projectAccessService.getMembership(
        projectId,
        invitee.id,
      );
      if (membership) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'User is already a member of this project',
        });
      }
    }

    if (await this.findPendingByEmail(projectId, email)) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'A pending invitation already exists for this email',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const invitation = this.invitationRepository.create({
      project_id: projectId,
      email,
      role,
      invited_by: actorId,
      token_hash: this.hashToken(token),
      expires_at: new Date(Date.now() + INVITATION_TTL_MS),
    });
    const saved = await this.invitationRepository.save(invitation);

    // Task 9 adds: in-app notification when the invitee already has an account.

    // The raw token is returned exactly once; only its hash is stored.
    return { ...saved.toJSON(), token };
  }

  async findPending(
    projectId: string,
    actorId: string,
  ): Promise<ApiListResponse<ProjectInvitation>> {
    await this.projectAccessService.ensureRole(
      projectId,
      actorId,
      ProjectRole.ADMIN,
    );
    const data = await this.invitationRepository.find({
      where: {
        project_id: projectId,
        accepted_at: IsNull(),
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      relations: ['inviter'],
      order: { created_at: 'DESC' },
    });
    return { data, status: HttpStatus.OK, success: true };
  }

  async revoke(
    projectId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void> {
    await this.projectAccessService.ensureRole(
      projectId,
      actorId,
      ProjectRole.ADMIN,
    );
    const invitation = await this.invitationRepository.findOneBy({
      id: invitationId,
      project_id: projectId,
    });
    if (!invitation) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Invitation not found',
      });
    }
    if (invitation.accepted_at) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'Invitation has already been accepted',
      });
    }
    if (invitation.revoked_at) return; // idempotent
    invitation.revoked_at = new Date();
    await this.invitationRepository.save(invitation);
  }
}
```

`src/modules/invitation/invitation.controller.ts` (the `accept` route is added in Task 9):

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ParseProjectIdPipe } from '../../common/pipes/parse-project-id.pipe';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';

@ApiTags('Project Invitations')
@Controller()
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post('projects/:projectId/invitations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create an invitation (admin+; owner to invite as admin). The raw token is returned only in this response.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Invitation created (includes one-time token)' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Already a member or already invited' })
  create(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.invitationService.create(projectId, dto, actorId);
  }

  @Get('projects/:projectId/invitations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List pending invitations (admin+)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of pending invitations' })
  @ApiResponse({ status: 403, description: 'Insufficient project role' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findPending(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.invitationService.findPending(projectId, actorId);
  }

  @Delete('projects/:projectId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a pending invitation (admin+)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'invitationId', description: 'Invitation UUID' })
  @ApiResponse({ status: 204, description: 'Invitation revoked' })
  @ApiResponse({ status: 404, description: 'Project or invitation not found' })
  @ApiResponse({ status: 409, description: 'Invitation already accepted' })
  revoke(
    @Param('projectId', ParseProjectIdPipe) projectId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.invitationService.revoke(projectId, invitationId, actorId);
  }
}
```

Update `invitation.module.ts`: add `controllers: [InvitationController], providers: [InvitationService]`.

- [ ] **Step 4: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern=invitation.service && pnpm build
git add src/modules/invitation
git commit -m "feat(invitation): create, list, revoke project invitations with hashed tokens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Invitation acceptance + in-app notification

**Files:**
- Create: `src/modules/invitation/dto/accept-invitation.dto.ts`
- Modify: `src/modules/invitation/invitation.service.ts` (add `accept`, add notification emit in `create`)
- Modify: `src/modules/invitation/invitation.controller.ts` (add `POST invitations/accept`)
- Modify: `src/modules/notification/notification.entity.ts` (add `PROJECT_INVITED` to `NotificationType`)
- Modify: `src/modules/notification/events/notification.events.ts` (add event const + `ProjectInvitedEvent`)
- Modify: `src/modules/notification/notification.listener.ts` (add handler)
- Modify: `src/modules/events/events.service.ts` (add WS handler)
- Create: `src/migrations/1787356802000-add-project-invited-notification-type.ts`
- Modify: `src/modules/invitation/invitation.service.spec.ts` (add accept cases)

**Interfaces:**
- Consumes: `InvitationService` internals (Task 8), `NotificationService.createBatch` pattern, `EventsService.emitToRecipients` pattern.
- Produces:
  - `InvitationService.accept(token: string, user: User): Promise<Project>` — validates, adds membership + marks accepted in one transaction, returns the joined project.
  - `NotificationType.PROJECT_INVITED = 'project_invited'`.
  - `NOTIFICATION_EVENTS.PROJECT_INVITED = 'notification.project.invited'` and `class ProjectInvitedEvent` with `entity_type = 'project_invitation'`, `actor_id`, `entity_id` (invitation uuid), `recipient_ids`, `payload: { project_id, project_name, role, inviter: { id, full_name, avatar_url } }`.

- [ ] **Step 1: Add failing accept tests to `invitation.service.spec.ts`**

```typescript
  describe('accept', () => {
    const now = Date.now();
    const rawToken = 'a'.repeat(64);
    const validInvitation = () =>
      ({
        id: 'inv-uuid',
        project_id: 'proj1234',
        email: 'jane@example.com',
        role: ProjectRole.MEMBER,
        expires_at: new Date(now + 60_000),
        accepted_at: null,
        revoked_at: null,
      }) as ProjectInvitation;
    const jane = { id: 'jane-id', email: 'Jane@Example.com' } as User;

    it('rejects an unknown token with the generic 400', async () => {
      invitationRepository.findOneBy.mockResolvedValue(null);
      await expect(service.accept(rawToken, jane)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });

    it('rejects an expired invitation', async () => {
      const invitation = validInvitation();
      invitation.expires_at = new Date(now - 1);
      invitationRepository.findOneBy.mockResolvedValue(invitation);
      await expect(service.accept(rawToken, jane)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });

    it('rejects a revoked invitation', async () => {
      const invitation = validInvitation();
      invitation.revoked_at = new Date();
      invitationRepository.findOneBy.mockResolvedValue(invitation);
      await expect(service.accept(rawToken, jane)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });

    it('rejects reuse of an accepted invitation', async () => {
      const invitation = validInvitation();
      invitation.accepted_at = new Date();
      invitationRepository.findOneBy.mockResolvedValue(invitation);
      await expect(service.accept(rawToken, jane)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });

    it('rejects a user whose email does not match, with the same generic 400', async () => {
      invitationRepository.findOneBy.mockResolvedValue(validInvitation());
      const mallory = { id: 'mallory', email: 'mallory@evil.com' } as User;
      await expect(service.accept(rawToken, mallory)).rejects.toThrow(
        'Invalid or expired invitation',
      );
    });

    it('409s when the accepting user is already a member', async () => {
      invitationRepository.findOneBy.mockResolvedValue(validInvitation());
      projectAccessService.getMembership.mockResolvedValue({ role: ProjectRole.MEMBER });
      await expect(service.accept(rawToken, jane)).rejects.toBeInstanceOf(ConflictException);
    });

    it('looks the invitation up by sha256(token), creates the membership, marks accepted, returns the project', async () => {
      const invitation = validInvitation();
      invitationRepository.findOneBy.mockResolvedValue(invitation);
      projectAccessService.getMembership.mockResolvedValue(null);
      projectService.findOneById.mockResolvedValue({ id: 'proj1234', name: 'P' });
      const result = await service.accept(rawToken, jane);
      expect(invitationRepository.findOneBy).toHaveBeenCalledWith({
        token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      });
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(invitation.accepted_at).toBeInstanceOf(Date);
      expect(invitation.accepted_by).toBe('jane-id');
      expect(result).toEqual({ id: 'proj1234', name: 'P' });
    });
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm exec jest --testPathPattern=invitation.service
```

Expected: FAIL — `accept` is not a function.

- [ ] **Step 3: Implement accept + DTO + route**

`src/modules/invitation/dto/accept-invitation.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'Raw invitation token from the invite link (64 hex chars)',
    example: '3f1a…',
  })
  @IsString()
  @Length(64, 64)
  token: string;
}
```

Add to `InvitationService` (import `BadRequestException` from `@nestjs/common`, `Project` from `../project/project.entity`):

```typescript
  async accept(token: string, user: User): Promise<Project> {
    const invitation = await this.invitationRepository.findOneBy({
      token_hash: this.hashToken(token),
    });

    // One generic error for every failure mode so this endpoint cannot be
    // used as an oracle for token validity or invitee emails.
    const invalid = () =>
      new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired invitation',
      });

    if (!invitation) throw invalid();
    if (
      invitation.revoked_at !== null ||
      invitation.accepted_at !== null ||
      invitation.expires_at.getTime() <= Date.now() ||
      invitation.email !== user.email.trim().toLowerCase()
    ) {
      throw invalid();
    }

    const membership = await this.projectAccessService.getMembership(
      invitation.project_id,
      user.id,
    );
    if (membership) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        message: 'You are already a member of this project',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(ProjectMember, {
          project_id: invitation.project_id,
          user_id: user.id,
          role: invitation.role,
        }),
      );
      invitation.accepted_at = new Date();
      invitation.accepted_by = user.id;
      await manager.save(invitation);
    });

    return this.projectService.findOneById(invitation.project_id);
  }
```

Add to `InvitationController`:

```typescript
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept an invitation by token (must be logged in as the invited email)',
  })
  @ApiResponse({ status: 200, description: 'Joined the project; returns the project' })
  @ApiResponse({ status: 400, description: 'Invalid or expired invitation' })
  @ApiResponse({ status: 409, description: 'Already a member' })
  accept(@Body() dto: AcceptInvitationDto, @CurrentUser() user: User) {
    return this.invitationService.accept(dto.token, user);
  }
```

(`@CurrentUser()` with no arg returns the full `User` — the JWT strategy reloads it per request, so `email` is live.)

- [ ] **Step 4: Wire the in-app notification**

1. `notification.entity.ts` — add to `NotificationType`:

```typescript
  PROJECT_INVITED = 'project_invited',
```

2. `notification.events.ts` — add to `NOTIFICATION_EVENTS`:

```typescript
  PROJECT_INVITED: 'notification.project.invited',
```

and the event class:

```typescript
export class ProjectInvitedEvent implements BaseNotificationEvent {
  entity_type = 'project_invitation' as const;

  constructor(
    public readonly actor_id: string,
    public readonly entity_id: string, // invitation id
    public readonly recipient_ids: string[],
    public readonly payload: {
      project_id: string;
      project_name: string;
      role: string;
      inviter: {
        id: string;
        full_name: string;
        avatar_url: string | null;
      };
    },
  ) {}
}
```

3. `notification.listener.ts` — add (same shape as the four existing handlers):

```typescript
  @OnEvent(NOTIFICATION_EVENTS.PROJECT_INVITED)
  async handleProjectInvited(event: ProjectInvitedEvent): Promise<void> {
    try {
      const notifications = event.recipient_ids.map((recipientId) => ({
        type: NotificationType.PROJECT_INVITED as NotificationType,
        recipient_id: recipientId,
        actor_id: event.actor_id,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        payload: event.payload,
      }));
      await this.notificationService.createBatch(notifications);
    } catch (error) {
      this.logger.error(
        'Failed to handle project.invited event',
        (error as Error).stack,
      );
    }
  }
```

4. `events.service.ts` — add (same shape as existing handlers):

```typescript
  @OnEvent(NOTIFICATION_EVENTS.PROJECT_INVITED, { async: true })
  handleProjectInvited(event: ProjectInvitedEvent): void {
    this.emitToRecipients(event.recipient_ids, event.actor_id, {
      type: 'project_invited',
      actorId: event.actor_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
    });
  }
```

5. In `InvitationService.create`, replace the `// Task 9 adds:` comment with (add `NOTIFICATION_EVENTS`, `ProjectInvitedEvent` imports from `../notification/events/notification.events`):

```typescript
    if (invitee) {
      const [project, inviter] = await Promise.all([
        this.projectService.findOneById(projectId),
        this.userRepository.findOneBy({ id: actorId }),
      ]);
      this.eventEmitter.emit(
        NOTIFICATION_EVENTS.PROJECT_INVITED,
        new ProjectInvitedEvent(actorId, saved.id, [invitee.id], {
          project_id: projectId,
          project_name: project.name,
          role,
          inviter: {
            id: actorId,
            full_name: inviter?.full_name ?? '',
            avatar_url: inviter?.avatar_url ?? null,
          },
        }),
      );
    }
```

6. Migration `src/migrations/1787356802000-add-project-invited-notification-type.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectInvitedNotificationType1787356802000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'project_invited'`,
    );
  }

  public async down(): Promise<void> {
    // Enum value removal requires type recreation; no-op.
  }
}
```

(Note: `notification_type` is the name from `src/migrations/1743120000000-create-notifications.ts`. If the live DB was created by `synchronize` instead, its enum may be named `notifications_type_enum` — irrelevant to dev, where `synchronize` also applies the entity change; the migration follows repo file convention.)

- [ ] **Step 5: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern="invitation|events" && pnpm build
git add src/modules/invitation src/modules/notification src/modules/events src/migrations/1787356802000-add-project-invited-notification-type.ts
git commit -m "feat(invitation): token acceptance with email binding and in-app notification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Secure project, board, and column routes

**Files:**
- Modify: `src/modules/project/project.controller.ts`, `src/modules/project/project.service.ts` (`findAll` scoped)
- Modify: `src/modules/board/board.controller.ts`, `src/modules/board/board.module.ts`
- Modify: `src/modules/kanban-column/kanban-column.controller.ts`, `kanban-column.service.ts`, `kanban-column.module.ts`

**Interfaces:**
- Consumes: `ProjectRoleGuard` + `@RequireProjectRole` (Task 4), `ProjectAccessService` (Task 2).
- Produces: `ProjectService.findAll(userId: string): Promise<Project[]>` (membership-scoped); `KanbanColumnService` methods take a required `actorId: string` as their last param.

- [ ] **Step 1: Project routes**

In `project.controller.ts` — import `ProjectRoleGuard` from `./guards/project-role.guard` and `RequireProjectRole` from `./decorators/require-project-role.decorator`, then:

| Route | Change |
|---|---|
| `GET /projects` | `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`; handler becomes `findAll(@CurrentUser('id') userId: string) { return this.projectService.findAll(userId); }` |
| `GET /projects/:id` | `@UseGuards(JwtAuthGuard, ProjectRoleGuard)` + `@ApiBearerAuth()` + `@RequireProjectRole(ProjectRole.VIEWER, 'id')` |
| `PATCH /projects/:id` | same guards + `@RequireProjectRole(ProjectRole.ADMIN, 'id')` |
| `DELETE /projects/:id` | same guards + `@RequireProjectRole(ProjectRole.OWNER, 'id')` |
| `GET /projects/:id/members` | same guards + `@RequireProjectRole(ProjectRole.VIEWER, 'id')` |

(`POST/DELETE :id/members` and `PATCH :id/members/:userId` keep JWT-only — their policy lives in the service.) Import `ProjectRole` from `./project-member.entity`. Add `@ApiResponse({ status: 403, ... })`/`404` entries where newly applicable.

In `project.service.ts`, replace `findAll()` with a membership-scoped version (keep the method name; drop the try/catch):

```typescript
  async findAll(userId: string): Promise<Project[]> {
    const memberships = await this.memberRepository.find({
      where: { user_id: userId },
      relations: ['project', 'project.creator'],
      order: { joined_at: 'DESC' },
    });
    return memberships.map((m) => m.project);
  }
```

- [ ] **Step 2: Board route**

`board.module.ts`: add `ProjectModule` to imports. `board.controller.ts`:

```typescript
  @Get(':projectId')
  @UseGuards(JwtAuthGuard, ProjectRoleGuard)
  @ApiBearerAuth()
  @RequireProjectRole(ProjectRole.VIEWER)
```

(plus imports: `UseGuards` from `@nestjs/common`, `ApiBearerAuth`, `JwtAuthGuard`, `ProjectRoleGuard`, `RequireProjectRole`, `ProjectRole`.) Add `@ApiResponse({ status: 401, description: 'Unauthenticated' })`.

- [ ] **Step 3: Column routes**

`kanban-column.module.ts`: add `ProjectModule` to imports. `kanban-column.service.ts`: inject `private readonly projectAccessService: ProjectAccessService` and change signatures (controller passes `@CurrentUser('id') actorId: string` on every route, all now `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`):

- `create(dto, actorId: string)`: first line `await this.projectAccessService.ensureRole(dto.project_id, actorId, ProjectRole.ADMIN);`
- `findAll(actorId: string)`: scope with `const projectIds = await this.projectAccessService.getProjectIdsForUser(actorId); if (projectIds.length === 0) return [];` then add `where: { project_id: In(projectIds) }` to the existing find options (import `In` from `typeorm`).
- `findOneById(id, actorId: string)`: after loading (or before, via helper): `const projectId = await this.projectAccessService.getProjectIdForColumn(id); await this.projectAccessService.ensureRole(projectId, actorId, ProjectRole.VIEWER);`
- `update(id, dto, actorId: string)` and `remove(id, actorId: string)`: same two lines with `ProjectRole.ADMIN`.

- [ ] **Step 4: Verify, commit**

```bash
pnpm build && pnpm exec jest
git add src/modules/project src/modules/board src/modules/kanban-column
git commit -m "feat(rbac): scope project, board, and column routes to membership

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Secure task-scoped routes (tasks, comments, subscriptions, activities)

**Files:**
- Modify: `src/modules/task/task.module.ts`, `task.controller.ts`, `task.service.ts`, `task.service.spec.ts`
- Modify: `src/modules/comment/comment.module.ts`, `comment.controller.ts`, `comment.service.ts`
- Modify: `src/modules/subscription/subscription.module.ts`, `subscription.controller.ts`, `subscription.service.ts`
- Modify: `src/modules/activity/activity.module.ts`, `activity.controller.ts`, `activity.service.ts`

**Interfaces:**
- Consumes: `ProjectAccessService.ensureTaskRole / ensureRole / getProjectIdsForUser` (Task 2).
- Produces (TaskService — controllers call these):
  - `findAllForUser(userId: string): Promise<Task[]>` (replaces controller use of `findAll`; the old unscoped `findAll` is **deleted**)
  - `findOneForUser(id: string, userId: string): Promise<Task>`
  - `findByTicketIdForUser(ticketId: string, userId: string): Promise<Task>`
  - `findSubtasksForUser(parentId: string, userId: string): Promise<ApiListResponse<Task>>`
  - All mutating methods take a **required** `actorId: string` (`remove(id, actorId)` and `reorderSubtask(id, subtaskId, position, actorId)` gain the param).

Rule of thumb applied everywhere: reads check `ProjectRole.VIEWER`, mutations check `ProjectRole.MEMBER`, all via `ensureTaskRole` (which also 404s unknown tasks — keeping the masking).

- [ ] **Step 1: Add failing tests to `task.service.spec.ts`**

Add a `ProjectAccessService` mock provider to the existing spec's `createTestingModule` providers:

```typescript
import { ProjectAccessService } from '../project/project-access.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectRole } from '../project/project-member.entity';

const projectAccessService = {
  ensureRole: jest.fn(),
  ensureTaskRole: jest.fn(),
  getProjectIdsForUser: jest.fn(),
  getProjectIdForTask: jest.fn(),
};
// in providers: { provide: ProjectAccessService, useValue: projectAccessService },
```

and a new describe block:

```typescript
  describe('authorization', () => {
    it('update rejects a viewer (403 propagates from the gate)', async () => {
      projectAccessService.ensureTaskRole.mockRejectedValue(new ForbiddenException());
      await expect(
        service.update('task-1', { title: 'x' } as any, 'viewer-user'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(projectAccessService.ensureTaskRole).toHaveBeenCalledWith(
        'task-1',
        'viewer-user',
        ProjectRole.MEMBER,
      );
    });

    it('findOneForUser 404-masks tasks in projects the user is not a member of', async () => {
      projectAccessService.ensureTaskRole.mockRejectedValue(new NotFoundException());
      await expect(service.findOneForUser('task-1', 'outsider')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('findAllForUser returns [] for a user with no memberships without querying tasks', async () => {
      projectAccessService.getProjectIdsForUser.mockResolvedValue([]);
      await expect(service.findAllForUser('lonely')).resolves.toEqual([]);
    });
  });
```

Run `pnpm exec jest --testPathPattern=task.service` — expected FAIL (missing provider/methods).

- [ ] **Step 2: TaskService changes**

1. `task.module.ts`: add `ProjectModule` to imports. `task.service.ts`: inject `private readonly projectAccessService: ProjectAccessService`; import `ProjectAccessService` and `ProjectRole`.
2. `create(dto: CreateTaskDto, actorId: string)` (drop the `?`): replace line 71 `await this.resolveColumn(taskData.column_id);` with:

```typescript
      const column = await this.resolveColumn(taskData.column_id);
      await this.projectAccessService.ensureRole(
        column.project_id,
        actorId,
        ProjectRole.MEMBER,
      );
```

Also add `ForbiddenException` to the create method's rethrow guard (`error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException`) — better: change these legacy guards to `error instanceof HttpException` (import from `@nestjs/common`) per CLAUDE.md, in every method you touch in this task.
3. Replace `findAll()` with:

```typescript
  async findAllForUser(userId: string): Promise<Task[]> {
    const projectIds =
      await this.projectAccessService.getProjectIdsForUser(userId);
    if (projectIds.length === 0) return [];
    return this.taskRepository.find({
      where: { parent_id: IsNull(), column: { project_id: In(projectIds) } },
      relations: ['assignees', 'labels', 'creator', 'subtasks', 'subtasks.parent'],
    });
  }
```

(import `In` from `typeorm`; delete the old `findAll`.)
4. Add read wrappers (keep `findOneById`/`findByTicketId`/`findSubtasks` as internal loaders):

```typescript
  async findOneForUser(id: string, userId: string): Promise<Task> {
    await this.projectAccessService.ensureTaskRole(id, userId, ProjectRole.VIEWER);
    return this.findOneById(id);
  }

  async findByTicketIdForUser(ticketId: string, userId: string): Promise<Task> {
    const task = await this.findByTicketId(ticketId);
    await this.projectAccessService.ensureTaskRole(task.id, userId, ProjectRole.VIEWER);
    return task;
  }

  async findSubtasksForUser(
    parentId: string,
    userId: string,
  ): Promise<ApiListResponse<Task>> {
    await this.projectAccessService.ensureTaskRole(parentId, userId, ProjectRole.VIEWER);
    return this.findSubtasks(parentId);
  }
```

5. For each mutating method — `update`, `reorder`, `move`, `remove`, `addAssignees`, `removeAssignees`, `addLabels`, `removeLabels`, `createSubtask`, `reorderSubtask` — make `actorId: string` required (add the param to `remove` and `reorderSubtask`) and insert as the first statement:

```typescript
    await this.projectAccessService.ensureTaskRole(
      <taskIdParam>,
      actorId,
      ProjectRole.MEMBER,
    );
```

where `<taskIdParam>` is the method's task-id argument (`id`, `taskId`, or the parent `id` for subtask methods). Place it *before* the legacy `try {` so authorization errors never hit the legacy catch blocks.

- [ ] **Step 3: TaskController changes**

- Add `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` to the six unguarded routes: `GET /`, `GET by-ticket/:ticketId`, `GET :id`, `DELETE :id`, `GET :id/subtasks`, `PATCH :id/subtasks/:subtaskId/reorder`.
- Add `@CurrentUser('id') userId: string` to each and call the new methods: `findAllForUser(userId)`, `findByTicketIdForUser(ticketId, userId)`, `findOneForUser(id, userId)`, `remove(id, userId)`, `findSubtasksForUser(id, userId)`, `reorderSubtask(id, subtaskId, dto.position, userId)`.
- Add `@ApiResponse({ status: 403, description: 'Requires member role' })` on mutating routes.

- [ ] **Step 4: Comments, subscriptions, activities**

For each module: add `ProjectModule` to the module imports; inject `ProjectAccessService` into the service.

**CommentService** (`comment.service.ts`):
- `create(taskId, authorId, dto)`: first line `await this.projectAccessService.ensureTaskRole(taskId, authorId, ProjectRole.MEMBER);`
- `findByTask(taskId, query, userId)` — add the `userId: string` param; first line `await this.projectAccessService.ensureTaskRole(taskId, userId, ProjectRole.VIEWER);`
- `update`/`remove`: unchanged (author-only checks already enforce ownership).

**CommentController**: `GET tasks/:taskId/comments` gains `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` + `@CurrentUser('id') userId: string`, passing it to `findByTask(taskId, query, userId)`.

**SubscriptionService**: the four controller-facing methods (subscribe via `POST :taskId/subscription`, unsubscribe, `subscription/me`, `subscribers`) each get `await this.projectAccessService.ensureTaskRole(taskId, userId, ProjectRole.VIEWER);` as their first line — **but only on the controller-facing entry points**. Internal auto-subscribe calls from `TaskService`/`CommentService` (`subscribe`, `subscribeMany` invoked with `SubscriptionSource.ASSIGNED` etc.) must NOT gain checks — the acting user was already authorized by the calling service, and recipients of an assignment may legitimately differ from the actor. If the controller and internal paths share one method, add wrapper methods `subscribeForUser`/`unsubscribeForUser` that check then delegate, and point the controller at the wrappers.

**ActivityService**: the `GET tasks/:taskId/activities` service method gains a `userId` param and the `ensureTaskRole(taskId, userId, ProjectRole.VIEWER)` first line; controller (already JWT-guarded) passes `@CurrentUser('id')`.

- [ ] **Step 5: Fix compile fallout, run everything, commit**

```bash
pnpm build 2>&1 | head -40   # chase remaining required-actorId call sites
pnpm exec jest
git add src/modules/task src/modules/comment src/modules/subscription src/modules/activity
git commit -m "feat(rbac): membership-scope all task, comment, subscription, activity routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: build green; all suites (including the pre-existing `task.service.spec.ts`, `comment.service.spec.ts`, `subscription.service.spec.ts` — update their provider lists with the `ProjectAccessService` mock, default `ensureTaskRole`/`ensureRole` to `jest.fn().mockResolvedValue('proj1234')` so existing behavior tests still pass) are green.

---

## Task 12: Secure team, user, and label routes

**Files:**
- Modify: `src/modules/team/team.controller.ts` (guard the three read routes)
- Modify: `src/modules/user/user.controller.ts`, `src/modules/user/user.service.ts`
- Modify: `src/modules/label/label.controller.ts`

**Interfaces:**
- Consumes: `ProjectRoleGuard`/`@RequireProjectRole` (Task 4).
- Produces: `UserService.findProjects(userId: string, callerId: string)` — 403 unless `userId === callerId`.

- [ ] **Step 1: Team reads**

`team.controller.ts` — `GET /`, `GET :teamId`, `GET :teamId/members` each gain:

```typescript
  @UseGuards(JwtAuthGuard, ProjectRoleGuard)
  @ApiBearerAuth()
  @RequireProjectRole(ProjectRole.VIEWER)
```

(imports: `ProjectRoleGuard`, `RequireProjectRole`, `ProjectRole` from the project module; `TeamModule` already imports `ProjectModule` since Task 3, which exports the guard.)

- [ ] **Step 2: User routes**

`user.controller.ts`:
- `GET /users` and `GET /users/:id`: add `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` (the full user list stays visible to any authenticated user — it powers invite/mention pickers; noted as accepted exposure).
- `GET /users/:id/projects`: add `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` + `@CurrentUser('id') callerId: string`, call `findProjects(id, callerId)`, add `@ApiResponse({ status: 403, description: 'Can only view your own projects' })`.
- `GET /users/me/projects`: change call to `findProjects(userId, userId)`.

`user.service.ts` — `findProjects` gains the caller check as its first statement:

```typescript
  async findProjects(
    userId: string,
    callerId: string,
  ): Promise<ApiListResponse<any>> {
    if (userId !== callerId) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'You can only view your own projects',
      });
    }
    // ...existing body unchanged
```

(import `ForbiddenException`; add `error instanceof ForbiddenException` to the method's legacy rethrow guard, or switch it to `error instanceof HttpException`.)

- [ ] **Step 3: Label routes**

`label.controller.ts`: add `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` to all five routes (imports from `@nestjs/common` / auth module). Labels are a global table (no `project_id` column) — project-scoping them is schema work, explicitly out of scope; JWT stops anonymous mutation.

- [ ] **Step 4: Verify, commit**

```bash
pnpm build && pnpm exec jest
git add src/modules/team src/modules/user src/modules/label
git commit -m "feat(rbac): guard team, user, and label routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13: Socket.IO board-room authorization

**Files:**
- Modify: `src/modules/events/events.gateway.ts` (add `board:join` / `board:leave` / `emitToProject`)
- Modify: `src/modules/events/events.module.ts` (import `ProjectModule`)
- Modify: `src/modules/events/events.gateway.spec.ts` (add tests)

**Interfaces:**
- Consumes: `ProjectAccessService.ensureRole` (Task 2).
- Produces: WS messages `board:join` / `board:leave` with payload `{ projectId: string }` (camelCase — the events module's established wire style); replies `board:join:success` / `board:join:error` / `board:leave:success`; room name `` `project:${projectId}` ``; `EventsGateway.emitToProject(projectId: string, event: string, data: any): void` for future board broadcasts.

- [ ] **Step 1: Write the failing tests**

Add to `events.gateway.spec.ts` — a mock provider and a describe block. Add to the module providers:

```typescript
import { ProjectAccessService } from '../project/project-access.service';
const mockProjectAccessService = { ensureRole: jest.fn() };
// in providers: { provide: ProjectAccessService, useValue: mockProjectAccessService },
```

```typescript
  describe('board rooms', () => {
    const makeClient = () =>
      ({
        id: 'socket-1',
        data: { user: { id: 'user-1' } },
        join: jest.fn().mockResolvedValue(undefined),
        leave: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
      }) as unknown as Socket;

    it('joins project room after a successful membership check', async () => {
      mockProjectAccessService.ensureRole.mockResolvedValue({});
      const client = makeClient();
      await gateway.handleBoardJoin(client, { projectId: 'proj1234' });
      expect(mockProjectAccessService.ensureRole).toHaveBeenCalledWith(
        'proj1234',
        'user-1',
        expect.anything(),
      );
      expect(client.join).toHaveBeenCalledWith('project:proj1234');
      expect(client.emit).toHaveBeenCalledWith('board:join:success', {
        projectId: 'proj1234',
      });
    });

    it('denies the join for non-members without joining the room', async () => {
      mockProjectAccessService.ensureRole.mockRejectedValue(new Error('no'));
      const client = makeClient();
      await gateway.handleBoardJoin(client, { projectId: 'proj1234' });
      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('board:join:error', {
        projectId: 'proj1234',
        message: 'You do not have access to this project',
      });
    });

    it('rejects a join with no projectId payload', async () => {
      const client = makeClient();
      await gateway.handleBoardJoin(client, {} as { projectId: string });
      expect(client.join).not.toHaveBeenCalled();
      expect(mockProjectAccessService.ensureRole).not.toHaveBeenCalled();
    });

    it('board:leave leaves the room', async () => {
      const client = makeClient();
      await gateway.handleBoardLeave(client, { projectId: 'proj1234' });
      expect(client.leave).toHaveBeenCalledWith('project:proj1234');
    });

    it('emitToProject targets the project room', () => {
      gateway.emitToProject('proj1234', 'task:moved', { id: 't1' });
      expect(gateway.server.to).toHaveBeenCalledWith('project:proj1234');
    });
  });
```

Run `pnpm exec jest --testPathPattern=events.gateway` — expected FAIL.

- [ ] **Step 2: Implement**

`events.module.ts`: add `ProjectModule` to imports (`import { ProjectModule } from '../project/project.module';`).

`events.gateway.ts`: inject `private readonly projectAccessService: ProjectAccessService` (import it and `ProjectRole` from the project module) and add:

```typescript
  @SubscribeMessage('board:join')
  async handleBoardJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ): Promise<void> {
    const userId: string | undefined = client.data?.user?.id;
    const projectId = data?.projectId;
    if (!userId || typeof projectId !== 'string' || projectId.length === 0) {
      client.emit('board:join:error', {
        projectId: projectId ?? null,
        message: 'You do not have access to this project',
      });
      return;
    }
    try {
      // Any membership (viewer+) may watch the board.
      await this.projectAccessService.ensureRole(
        projectId,
        userId,
        ProjectRole.VIEWER,
      );
      await client.join(`project:${projectId}`);
      client.emit('board:join:success', { projectId });
    } catch {
      client.emit('board:join:error', {
        projectId,
        message: 'You do not have access to this project',
      });
    }
  }

  @SubscribeMessage('board:leave')
  async handleBoardLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string },
  ): Promise<void> {
    const projectId = data?.projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) return;
    await client.leave(`project:${projectId}`);
    client.emit('board:leave:success', { projectId });
  }

  emitToProject(projectId: string, event: string, data: any): void {
    this.server.to(`project:${projectId}`).emit(event, data);
  }
```

Wait for the check to pass before `join` — never join-then-verify. The generic error message is intentional (no membership oracle over WS).

- [ ] **Step 3: Run tests, build, commit**

```bash
pnpm exec jest --testPathPattern=events.gateway && pnpm build
git add src/modules/events
git commit -m "feat(events): membership-authorized project board rooms

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 14: Documentation + final verification

**Files:**
- Modify: `CLAUDE.md` (Authentication & Authorization section)

- [ ] **Step 1: Update CLAUDE.md**

In the **Authentication & Authorization** section: replace the sentence about `ensureProjectRole` and the roles bullet with:

```markdown
- **A valid JWT proves identity, not authorization.** Every project-scoped action goes through `ProjectAccessService` (`src/modules/project/project-access.service.ts`): `ensureRole(projectId, userId, minRole)` for path-scoped resources, `ensureTaskRole(taskId, userId, minRole)` for task-scoped ones. Routes with a project id in the path can use `@UseGuards(JwtAuthGuard, ProjectRoleGuard)` + `@RequireProjectRole(role, param)` instead. Passing `userId` in only to emit activity/notification events is not an access check.
- **Roles:** project-scoped `ProjectRole` (OWNER > ADMIN > MEMBER > VIEWER). Reads need any membership; task/comment mutations need MEMBER; project/team/column/member/invitation management needs ADMIN; deleting the project, touching owner/admin roles, and inviting admins need OWNER. `User.role`/`UserRole` remains descriptive metadata — don't gate on it.
- **404 masking:** a non-member gets `404 Project not found` from every project-scoped route (anti-enumeration); a member below the required role gets 403. Don't reintroduce 403 for non-members.
- **Invitations** (`src/modules/invitation/`): tokens are 32 random bytes returned once at creation; only the sha256 hash is stored (`token_hash`, `select: false`). 7-day expiry, revocable, single-use, and acceptance requires the authed user's email to match — all invalid-token failures return the same generic 400. No mailer exists: delivery is an out-of-band invite link + in-app notification for existing users.
- **WS rooms:** clients join `project:{id}` via `board:join`, which verifies membership first; `user:{id}` rooms come from the JWT handshake. Never `client.join` before the membership check.
```

Also update the parenthetical "(Several routes are currently unguarded — treat that as a bug, not a pattern.)" — after this feature it should read "(All routes are guarded; new routes must be too.)".

- [ ] **Step 2: Full verification sweep**

```bash
pnpm lint && pnpm build && pnpm exec jest
```

Expected: all green. Then a manual security spot-check with the dev server (`pnpm start:dev`, Swagger at `http://localhost:1996/api/docs`):
1. No token → `GET /api/projects` → 401.
2. User A creates a project; user B (no membership) → `GET /api/projects/<idA>` → **404** (not 403).
3. A invites B as `viewer` → response contains 64-char `token`; `GET .../invitations` response contains **no** `token_hash`.
4. B accepts with the token → 200 + project; second accept → 400.
5. B (viewer) → `PATCH /api/tasks/<taskInA>` → 403; `GET /api/board/<idA>` → 200.
6. A demoting themself → 403 (self-change); A removing themself as sole owner → 409.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document RBAC model, 404 masking, and invitation conventions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then stop: pushing and opening the PR (`gh pr create --base main`) requires the user's explicit go-ahead per `.claude/rules/git.md`.

---

## Out of scope (explicitly deferred — do not gold-plate)

- **Frontend work** (projects list, member management UI, `usePermissions()`, 403 states) — separate plan in the frontend repo.
- **Email delivery** of invitations (no mailer in this repo; the one-time-token + invite-link flow is the contract the frontend builds on).
- **Project-scoping labels** (global table today; needs its own schema migration).
- **Validating that task assignees are project members** (data-integrity follow-up, not an authorization hole).
- **Presence query scoping** (`GET /presence?user_ids=` remains visible to any authenticated user).
- **Real-DB e2e tests** (repo's e2e is starter boilerplate; the permission matrix is covered by service-level specs per repo convention).
- The repo-wide "Known Decisions" items (response envelope, versioning, helmet/CORS).

## Appendix: Source Spec & Design Decisions

**Feature (from the user's brief):** Project membership & RBAC — owner/admin/member/viewer roles; invite/remove members and change roles; permissions controlling project editing, task creation/movement, member management, and visibility. Backend scope: membership + invitation APIs, central authorization middleware/policies, project-scoped queries, invitation acceptance/expiry, role-change rules, last-owner protection, authorization for HTTP **and** Socket.IO rooms. Security: no cross-project enumeration, hashed invitation tokens, expiry/revocation, no self-escalation, last-owner protection, authorized socket joins, no leaking that private projects exist. The server — never the UI — enforces every permission.

**Design decisions made against the existing codebase:**
1. `ProjectMember`/`ProjectRole` (owner/admin/member) and `ensureProjectRole` already existed — this plan extends them (adds `viewer`) rather than re-modeling; `project_members` already has the composite PK `(project_id, user_id)`, satisfying the uniqueness requirement.
2. Non-membership → **404** (masks existence), insufficient role → **403**. This changes the previous behavior (403 "You are not a member") deliberately, per the anti-enumeration requirement.
3. Central policy is a service (`ProjectAccessService`) + a guard for path-scoped routes, because task/comment routes have no project id in the path — resolution (task → column → project) must hit the DB, which services do idiomatically in this codebase.
4. Invitations return the raw token once (create response) because the repo has no mailer; in-app notification covers existing users; email-binding on acceptance keeps a leaked link useless to others.
5. Owner is never grantable by invitation; admins manage member/viewer; owners manage everything; no self role change; `409` for anything that would leave zero owners.
6. Legacy try/catch blocks that leak `error.message` are not copied into new code; methods rewritten by this plan throw typed exceptions directly (per CLAUDE.md).
