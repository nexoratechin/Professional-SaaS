# Professional-SaaS

A configurable, multi-tenant College ERP SaaS platform for managing admissions, students, academics, attendance, examinations, fees, faculty, library, hostel, transport, placements, and institutional operations — built to serve one college initially and scale to hundreds of colleges.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Web** (`apps/web`): React + Vite + `vite-plugin-pwa`
- **API** (`apps/api`): NestJS REST platform
- **Worker** (`apps/worker`): BullMQ background jobs
- **Database** (`packages/database`): Prisma + PostgreSQL
- **Shared packages:** auth, queue, payments, notifications, integrations, reporting, analytics, observability, certificates, imports, gps, types, ui
- **Redis** for queues/cache · **object storage**: local filesystem by default (no MinIO needed), S3-compatible in production for documents

## Local development

Runs natively on your machine — **no Docker**. See [`docs/local-development.md`](docs/local-development.md)
for full setup (PostgreSQL, Redis, environment files). Documents use a local directory by default,
so no MinIO is needed for development.

Quick start:

```bash
corepack enable            # uses the pinned pnpm@9.12.0
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
pnpm db:generate
pnpm db:migrate            # or: pnpm db:deploy:safe  (never resets your data)
pnpm dev                   # web :5173 · api :3000 · worker :3100
```

Run each app on its own: `pnpm dev:web`, `pnpm dev:api`, `pnpm dev:worker`.

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run web + api + worker (Turbo, parallel) |
| `pnpm build` | Build the whole workspace |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm test:e2e` | API end-to-end suite (needs PostgreSQL + Redis) |
| `pnpm db:generate` | Generate Prisma Client |
| `pnpm db:migrate` | Apply migrations (development) |
| `pnpm db:deploy:safe` | Pre-migration backup + `prisma migrate deploy` |
| `pnpm db:seed` | Seed catalog + platform admin (+ demo data off-prod) |
