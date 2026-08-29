# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban board backend API built with NestJS 11, TypeScript, TypeORM, and PostgreSQL (Supabase).

## Package Manager

This project uses **pnpm**. Do not use `npm` or `yarn`.

## Commands

- **Install:** `pnpm install`
- **Dev server:** `pnpm start:dev` (watch mode on port 1996)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint` (ESLint with auto-fix)
- **Format:** `pnpm format` (Prettier)
- **Unit tests:** `pnpm test`
- **Single test:** `pnpm exec jest --testPathPattern=<pattern>` (e.g. `pnpm exec jest --testPathPattern=app.controller`)
- **E2E tests:** `pnpm test:e2e`
- **Test coverage:** `pnpm test:cov`

## Architecture

- **Framework:** NestJS with Express adapter, using decorators and dependency injection
- **Database:** TypeORM with PostgreSQL; config in `src/database/typeorm.ts` using `@nestjs/config` registerAs pattern
- **Entity discovery:** TypeORM auto-discovers entities at `src/modules/**/*.entity.{ts,js}`
- **Module convention:** Feature modules go in `src/modules/` — each module should contain its controller, service, entity, and DTOs
- **Unit tests:** Colocated with source files as `*.spec.ts`; E2E tests live in `test/`
- **Environment:** Config via `.env` file (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)

## Code Style

- ESLint flat config (`eslint.config.mjs`) with Prettier integration
- `@typescript-eslint/no-explicit-any` is disabled
- Single quotes, trailing commas (`all`)
- Target: ES2023, module: nodenext

## API Conventions

- **Prefix & docs:** Global `/api` prefix (`main.ts`); no URL versioning. Swagger UI at `/api/docs`, mounted only when `NODE_ENV !== 'production'`.
- **Routing:** Controllers are plural-noun, kebab-case (`@Controller('tasks')`); multi-word segments/actions use kebab-case (`unread-count`, `by-ticket/:ticketId`, `me/projects`). Nest child resources under a parent path (`projects/:projectId/teams`, `tasks/:taskId/comments`) and model relationship changes as sub-resource `POST`/`DELETE` (`:id/assignees`, `:id/labels`, `:id/members`). (`board` is the one legacy singular controller — don't copy it.)
- **Validation:** Every request field lives on a class-validator DTO. The global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`, `main.ts`) is the only validation gate — never validate manually in controllers/services. Coerce query params explicitly with `@Type(() => Number)` (transform doesn't infer primitives from query strings).
- **Path params:** UUID ids → `ParseUUIDPipe`; integer ids (label, kanban-column, team) → `ParseIntPipe`; project ids → `ParseProjectIdPipe` (`src/common/pipes`).
- **Swagger:** Decorate every controller (`@ApiTags`), every route (`@ApiOperation` + `@ApiResponse`; `@ApiParam` for path params; `@ApiBearerAuth` on guarded routes), and every DTO field (`@ApiProperty`/`@ApiPropertyOptional`).
- **Status codes:** Use Nest's method default; add `@HttpCode` only to deviate (login `POST` → 200; `DELETE` with no body → `@HttpCode(HttpStatus.NO_CONTENT)`). Apply the DELETE rule uniformly — some current DELETEs are 204, others default to 200.
- **Pagination:** Offset-based — `page` (1-based, default 1) + `limit` (default 20, max 100). No cursor pagination.

## Wire Format

- **snake_case everywhere on the wire:** JSON request/response fields, DTO properties, and TypeORM `@Column` names are all snake_case (`full_name`, `access_token`, `column_id`, `due_date`, `ticket_id`). Do not introduce camelCase request/response fields. (Known camelCase surfaces: WebSocket event DTOs in `src/modules/events/dto` and `board-query.dto.ts` — don't extend them.)

## Responses & Error Handling

- **No global response envelope** (no response interceptor). Three shapes coexist — match the module you're editing: list endpoints often use `ApiListResponse<T>` = `{ data, status, success, message? }`; single-entity/board endpoints return the raw entity/DTO; paginated comments use `{ data, meta: { page, limit, total, totalPages } }` — reuse that exact shape for new paginated lists.
- **Throw, don't catch in controllers.** Services throw Nest exceptions; controllers never try/catch. Mapping: `NotFoundException` 404, `ForbiddenException` 403 (ownership/role), `ConflictException` 409, `BadRequestException` 400, `UnauthorizedException` 401.
- **Never leak internals to clients:** do not put `error: (error as Error).message` in a response body — it exposes SQL/constraint text. Log with `this.logger.error(...)` and throw a generic message. Much existing code leaks — don't copy it.
- If a service keeps a try/catch that re-throws, guard on `error instanceof HttpException` (not a hand-listed set of subclasses) so a new throw isn't downgraded to 500. Put cross-cutting error/response shaping in an `APP_FILTER`/interceptor, not per-controller.

## Authentication & Authorization

- **Auth is opt-in per route** via `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`. There is NO global guard, so any undecorated route is fully public. Guard every mutating route and every sensitive read. (Several routes are currently unguarded — treat that as a bug, not a pattern.)
- **A valid JWT proves identity, not authorization.** For project/task/comment/team operations, also enforce access via `ProjectAccessService` (`src/modules/project/project-access.service.ts`): `ensureRole(projectId, userId, minRole)` for project-scoped actions, `ensureTaskRole`/`ensureColumnRole` for task/column-scoped ones, or resource ownership (e.g. comment `author_id === userId`). Actor ids on gated service methods are **required**, never optional (optional actor = skipped check). Passing `userId` in only to emit activity/notification events is not an access check.
- **Roles:** project-scoped `ProjectRole` (OWNER > ADMIN > MEMBER > VIEWER) via `ProjectAccessService` is the only authorization gate. Run the gate **before** any resource lookup: non-members get a masked 404 indistinguishable from a missing resource (anti-enumeration); members below the required role get 403. `User.role`/`UserRole` is descriptive metadata — don't gate on it without a real `RolesGuard`.
- Read the caller with `@CurrentUser('id')`; the JWT strategy reloads the live `User` per request and rejects inactive users.
- **Secrets:** never return `password_hash` (keep `select: false` + `@ApiHideProperty`; load only via `UserService.findOneByEmailWithPassword`). Hash with bcryptjs. Refresh tokens are opaque random values stored as sha256 hashes, rotated with reuse-detection on every refresh — never issue a JWT as the refresh token.

## Data Layer (TypeORM)

- **Access:** constructor `@InjectRepository(Entity)` + `Repository<T>`. Use `QueryBuilder` only for joins/filters the repository API can't express; use `DataSource.query` only for the position stored procedures (`fn_move_task`, `fn_reorder_task`, `fn_reorder_subtask`).
- **Relations:** load explicitly per query (`relations: [...]` or `leftJoin` + `addSelect`); no lazy relations, no relation access inside loops. Mutations follow save-then-refetch (`save`, then `findOneById()` re-queries the relation graph for the response).
- **Transactions:** wrap any multi-row write that must stay consistent (membership changes) in `dataSource.transaction(...)` — follow `ProjectService.create`.
- **Bound collection queries:** paginate (`skip`/`take` + `findAndCount`) and select needed columns; don't return unbounded full relation graphs.
- **Schema via migrations, not `synchronize`.** Currently `synchronize` is effectively ON (`app.module.ts` keys it off unset `NODE_ENV`) and `typeorm.ts` hardcodes `synchronize: true` with no `migrations` glob, so `src/migrations/*` never runs. Set `synchronize: false`, set `NODE_ENV` per environment, register `migrations: [__dirname + '/../migrations/*{.ts,.js}']`, and evolve schema via `typeorm migration:generate`.

## Shared Utilities, Logging & Tests

- **Logging:** one `private readonly logger = new Logger(ClassName.name)` per service/gateway/listener. No `console.*` outside `src/database/seed.ts`.
- **HTML sanitization:** sanitize user-supplied HTML at the DTO boundary with the shared `sanitize()` util (`src/common/utils`) via `@Transform`. Apply to any new field rendered as HTML (only comment content does today).
- **Module shape:** `src/modules/<feature>/` = controller + service + module + entity + DTOs. Aggregation/gateway modules omit pieces intentionally (`board` = read-only aggregation, no entity; `events` = WS gateway) — follow the neighboring module.
- **Tests:** coverage is minimal (only `app.controller` and `events.gateway` have specs; e2e is starter boilerplate). Add `*.service.spec.ts` with `Test.createTestingModule` + repository mocks for new work — follow `events.gateway.spec.ts`.

## Skills (`.claude/skills/`)

Auto-load by description; invoke explicitly when one clearly fits. The first two are generic references — where their advice conflicts with the conventions in this file (e.g. URL versioning, response envelopes, pagination params), **this file wins**.

- **`api-design`** — REST API design patterns: resource naming, status codes, pagination/filtering, error responses, versioning, rate limiting. Use when designing new endpoints or reviewing an API contract.
- **`backend-patterns`** — backend architecture & server-side practices: controller/service/repository layering, DB query optimization (N+1, indexing, pooling), caching, background jobs, middleware. Use for service-layer or data-access design.
- **`api-review`** — repo-specific checklist for reviewing API implementations before merge: guards + `ProjectAccessService` authorization and the 404-masking contract, wire format, validation pipeline, pagination/N+1/transactions, Swagger, error hygiene. Synthesizes the two references above and resolves their conflicts in this repo's favor.

## Known Decisions (not yet settled)

These are contract/scaffolding choices, not existing conventions — confirm before relying on them: unifying the response envelope; API versioning (`enableVersioning`); standardizing DELETE on 204; env-schema validation on `ConfigModule` (fail-fast at boot); security hardening (helmet, CORS allowlist replacing `origin:'*'`, body-size limit).
