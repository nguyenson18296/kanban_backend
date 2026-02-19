# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban board backend API built with NestJS 11, TypeScript, TypeORM, and PostgreSQL (Supabase).

## Commands

- **Dev server:** `npm run start:dev` (watch mode on port 3000)
- **Build:** `npm run build`
- **Lint:** `npm run lint` (ESLint with auto-fix)
- **Format:** `npm run format` (Prettier)
- **Unit tests:** `npm test`
- **Single test:** `npx jest --testPathPattern=<pattern>` (e.g. `npx jest --testPathPattern=app.controller`)
- **E2E tests:** `npm run test:e2e`
- **Test coverage:** `npm run test:cov`

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
