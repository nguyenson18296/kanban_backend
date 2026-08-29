---
name: api-review
description: Use when reviewing an API implementation in this repo — a new or changed NestJS endpoint, controller, service, DTO, or route — before it merges; also when asked to "review this endpoint/API", check a module for auth or authorization gaps, or audit request/response contracts.
---

# API Implementation Review

Repo-specific review procedure for kanban_backend endpoints. It synthesizes `api-design` (HTTP contract depth) and `backend-patterns` (layering & data access depth) — consult them for background; **where they disagree with this repo, this checklist and CLAUDE.md win** (conflict table below).

## Procedure

1. Map the surface under review: routes → DTOs → service methods → entities touched.
2. Walk EVERY checklist row below against the code; verify claims in the repo (an existing neighboring module is the precedent), and confirm any helper you recommend actually exists at the path you cite.
3. Report severity-ranked findings (Critical/Important/Minor), each with file:line, what's wrong, why it matters, and the fix. End with a verdict: approve | needs fixes.

## Checklist — every row, every review

### AuthN/AuthZ (the #1 axis; identity ≠ authorization)
- [ ] Every route has `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`. There is NO global guard — an undecorated route is fully public.
- [ ] Every project-scoped action authorizes through `ProjectAccessService` (`src/modules/project/project-access.service.ts`): `ensureRole(projectId, userId, minRole)`, `ensureTaskRole(taskId, …)`, `ensureColumnRole(columnId, …)` — or, when the project id is a route param, `@UseGuards(JwtAuthGuard, ProjectRoleGuard)` + `@RequireProjectRole(role, param)`. Hand-rolled membership lookups are a defect. (`ProjectService.ensureProjectRole` was removed — never recommend it.)
- [ ] Minimum roles match the matrix: reads → any membership (VIEWER); task/comment mutations → MEMBER; project/team/column/member/invitation management → ADMIN; project delete, owner/admin role changes, admin invites → OWNER.
- [ ] **404 masking:** a non-member gets a 404 indistinguishable from not-exists — never 403, and never an error message embedding a resolved internal id (enumeration oracle). 403 is reserved for members below the required role.
- [ ] Client-supplied cross-entity ids (`column_id`, `parent_id`, body `project_id`) are validated against the actor's project — no writes into, or reads through, a foreign project.
- [ ] Raw SQL only for the `fn_*` stored procedures and always parameterized — string interpolation into `.query()` is Critical (injection).

### Contract
- [ ] Routes: plural nouns, kebab-case, nested under the parent (`projects/:projectId/…`, `tasks/:taskId/…`); no verbs in URLs; no `/v1` versioning.
- [ ] Status codes: Nest defaults; POST → 201; **DELETE with no body → `@HttpCode(HttpStatus.NO_CONTENT)`**; a forced 200 needs a stated reason (login).
- [ ] Response uses a sanctioned shape: `ApiListResponse<T>` `{ data, status, success, message? }`, raw entity/DTO, or paginated `{ data, meta: { page, limit, total, totalPages } }`. Invented envelopes (`{ ok, result }`, `{ success: true }`) are defects.
- [ ] Swagger complete: `@ApiTags`, `@ApiOperation` + `@ApiResponse` (incl. 401/403/404 where reachable), `@ApiParam`, `@ApiBearerAuth`, `@ApiProperty`/`@ApiPropertyOptional` on every DTO field.

### Validation & wire format
- [ ] Every request field lives on a class-validator DTO; the global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform) is the only gate. An undecorated DTO field is stripped/rejected at runtime — that's a broken endpoint, not a style nit. No manual validation in controllers or services.
- [ ] snake_case on the wire (request/response fields, DTO props, columns). camelCase only on the sanctioned surfaces (events WS DTOs, `board-query.dto.ts`).
- [ ] Numeric query params carry `@Type(() => Number)` — `transform` does NOT coerce query strings by itself.
- [ ] Path params piped: UUID → `ParseUUIDPipe`; int ids → `ParseIntPipe` (never `Number(param)`); project ids → `ParseProjectIdPipe`.
- [ ] User-supplied HTML that gets rendered → shared `sanitize()` util via `@Transform` on the DTO.

### Data layer
- [ ] List queries bounded: `skip`/`take` (+ `findAndCount` when returning meta); accepted `page`/`limit` params are actually applied.
- [ ] No query inside a loop (N+1) — batch or aggregate; relations loaded explicitly and only what the response needs.
- [ ] Multi-row writes that must stay consistent are wrapped in `dataSource.transaction(...)`; read-modify-write counters are a lost-update race — flag them.
- [ ] Side effects are symmetric (a delete reverses what create incremented/attached).

### Errors, observability, tests
- [ ] Controllers never try/catch; services throw Nest exceptions with `{ statusCode, message }` bodies. Kept catch blocks re-throw on `error instanceof HttpException` (not a hand-listed subclass set).
- [ ] No `error: (error as Error).message`, stack, or SQL text in any response body — log via `this.logger`, throw generic.
- [ ] One `private readonly logger = new Logger(ClassName.name)`; no `console.*`.
- [ ] New service logic ships a `*.service.spec.ts` with `Test.createTestingModule` + repository mocks.

## Where the reference skills conflict with this repo

| `api-design` / `backend-patterns` say | This repo does |
|---|---|
| `/api/v1/` URL versioning | No URL versioning |
| Cursor pagination by default | Offset only: `page` (1-based) + `limit` (default 20, max 100) |
| 422 for semantic validation errors | Global pipe → 400 |
| `{ error: { code, message, details } }` envelope | Nest `{ statusCode, message }` |
| Controller try/catch into a central `errorHandler()` | Throw; cross-cutting shaping belongs in an `APP_FILTER` |
| In-memory queues / per-process rate limiting | Not production patterns here — don't recommend them |

## Common mistakes when reviewing here

- Approving a mutation because JWT is present — a valid token proves identity, not authorization.
- Recommending 403 for non-members — that breaks the 404-masking contract and creates an enumeration oracle.
- Treating a decorator-less DTO as "missing polish" — under this pipe it is a functional break (every field rejected).
- Citing a helper without verifying it still exists — APIs move; check the file before naming it in a fix.
