# Phase 48 — Remove Docker, Redis and MinIO if unused (dependency audit)

**Date:** 2026-10-11
**Scope:** `Professional-SaaS` monorepo (College ERP SaaS).

This is the audit that Phase 48 requires before removing anything. The short version: **Docker was
already absent, MinIO is now removable for local development (replaced by a local-filesystem
storage driver), and Redis/BullMQ is a genuine hard dependency that cannot be removed safely today
— it is preserved, with a concrete replacement proposal, rather than ripped out.**

## What was asked

1. Identify whether Redis, BullMQ, MinIO or other external services are actually used.
2. Search source, dependencies, env vars, workers, storage adapters, scripts, tests and deployment
   config for references.
3. Remove Redis if unused; replace optional caching where safe; preserve critical jobs and propose a
   replacement before removing anything.
4. Remove MinIO if unused; otherwise implement/retain a secure storage adapter with local-filesystem
   support for dev and a durable provider for production.
5. Remove Docker files and instructions completely.
6. Preserve PostgreSQL, the ORM, auth, multi-tenancy, billing, permissions, student records,
   documents and all existing ERP functionality.
7. Do not delete files/data, reset the database, or replace working functionality with mocks.
8. Update env examples, scripts, tests and docs.
9. Run tests, lint, typechecks, database validation and builds; report actual results.

## Findings

### Docker — already gone; only stale references remained

| Search | Result |
| --- | --- |
| `Dockerfile`, `docker-compose*.yml`, `.dockerignore`, `compose*.yml` | **none** |
| `docker` in source/scripts/CI | only comments stating there is no Docker |

`docs/local-development.md` already says "Docker is not used anywhere". The one remaining stale
artifact was the root `.env.example`, which still carried container-orchestration variables
(`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `REDIS_PORT`) that
nothing in the repo read — these were removed. A historical comment in
`packages/database/prisma/migrations/20260907062647_init_foundation_and_organization/migration.sql`
mentions the old compose file; migrations are immutable (checksummed), so it was intentionally left
untouched.

**No Docker files to delete — the repository already runs natively.**

### MinIO / S3 — used, but replaceable for development

`MinIO` was the local endpoint for the S3-compatible `StorageService`. It is referenced by:

- `apps/api/src/common/storage/storage.service.ts` (`@aws-sdk/client-s3`, presigning)
- `apps/worker/src/common/storage/worker-storage.service.ts` (virus-scan/retention/backups)
- config keys `S3_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY/BUCKET/FORCE_PATH_STYLE`
- document, branding, HR, certificate, report, import/export, placement and student-portal features
- health/alerting probes (`storage`, `dependency_storage_down`)

So MinIO is **used**, but only as *one implementation* of an object-storage interface. Per the task,
a secure storage adapter supporting local filesystem storage for development (and S3 for
production) was implemented — see "Changes made" below. MinIO is therefore **no longer required
locally**.

### Redis / BullMQ — genuinely used; NOT safe to remove

Redis is a hard dependency of the running platform, not an optional cache:

- **BullMQ queues** (`@nestjs/bullmq` + `bullmq`, registered in both apps) — background jobs that
  the ERP depends on: notifications + campaigns, document virus scan + retention, report exports,
  certificate/PDF generation, data imports, analytics refresh, integrations, payment
  reconciliation, subscription lifecycle, helpdesk SLA, workflow escalation, transport GPS sweeps,
  AI document processing, backups, dead-letter. These are **not** decorative; several are the only
  path that completes a user-visible operation.
- **Stateful auth flows**: MFA challenge state, OIDC/SSO authorization state, refresh/idempotency
  keys, login-risk counters — Redis is the store.
- **Caching**: tenant lookup, effective permissions, tenant features, OIDC discovery/JWKS.
- **Observability**: rate-limit windows, worker heartbeats (the API's readiness probe and
  `worker_offline` alert read them), alert dedupe, time-window counters.

Replacing BullMQ with a non-Redis queue means touching every processor, both `BullModule.forRoot`
configurations, the queue-events bridge, the dead-letter service, the scheduler services, the
monitoring service and the metrics — a large, high-risk change. Per instruction 3, the jobs are
**preserved** and a replacement is proposed rather than started.

#### Proposed replacement (not implemented in this phase)

**pg-boss** — a PostgreSQL-backed job queue:

- Same PostgreSQL instance already required, so no new infrastructure; removes the Redis
  dependency for queues.
- Supports retries/backoff, delayed jobs, singletons/dedupe, dead-letter and archives — the
  primitives the current queues use.
- Migration path: introduce a `@college-erp/queue` adapter interface, land a `pg-boss` backend
  behind it, port schedulers/processors queue by queue, then move the remaining stateful bits
  (MFA/SSO state, idempotency keys, rate-limit windows) to Postgres tables or a small
  Redis-compatible shim. Each stateful flow must be migrated and tested before Redis can be
  removed, because losing MFA/SSO state mid-login is a security regression, not just a job hiccup.

Until that migration lands, **Redis is required for full functionality** (the API can boot and
serve read paths without it, but background jobs and the auth state above will not work).

## Changes made

### 1. Local filesystem storage driver (`STORAGE_DRIVER=local`)

- `packages/config`: added `STORAGE_DRIVER` (`s3|local`, default `s3`), `STORAGE_LOCAL_DIR`
  (default `.data/storage`), `STORAGE_LOCAL_URL_BASE` and `STORAGE_LOCAL_SIGNING_SECRET`. S3 keys
  now have development defaults instead of being mandatory, so `local` needs no S3 config.
- `apps/api/src/common/storage/local-storage.ts`: `LocalObjectStore` (tenant-scoped filesystem
  writes under `<dir>/<bucket>/<key>`, traversal-safe) and signed, single-purpose, time-limited
  URL tokens (`put`/`get`, HMAC-SHA256) that mirror S3 presigning semantics.
- `apps/api/src/common/storage/local-storage.controller.ts`: public `/storage/local/:token`
  endpoint that verifies a token and streams bytes to/from disk. Excluded from tenant resolution
  (the token carries the key).
- `apps/api/src/common/storage/storage.service.ts` and
  `apps/worker/src/common/storage/worker-storage.service.ts`: branch on the driver. The S3 path is
  byte-for-byte unchanged; `local` uses the filesystem. Both apps resolve a relative
  `STORAGE_LOCAL_DIR` against the workspace root so they share one store.
- Security is preserved on the local path: the same `assertKeyBelongsToTenant` /
  `assertKeyInCategory` checks run before any URL is minted, tokens are HMAC-signed and expire, an
  arbitrary declared content type is still downgraded to `application/octet-stream` with
  `attachment`, and responses set `X-Content-Type-Options: nosniff`.

### 2. Docker / MinIO cleanup

- Removed the unused MinIO/Redis container variables from root `.env.example`.
- README and `docs/local-development.md` updated: object storage is local by default; MinIO is only
  needed if you deliberately opt into `STORAGE_DRIVER=s3`.
- `.gitignore` ignores the local store (`.data/`).

### 3. Env / docs / tests

- `apps/api/.env.example`, `apps/worker/.env.example`: document `STORAGE_DRIVER=local` (default) and
  the S3 path.
- Removed the "MinIO install" instructions and troubleshooting entry from
  `docs/local-development.md`.
- Added `apps/api/src/common/storage/storage.local.spec.ts`.

## What was intentionally NOT done

- **Redis was not removed.** The audit (above) shows critical BullMQ jobs and auth state depend on
  it. A pg-boss proposal is documented instead.
- **No data/files were deleted; no migration was run; the database was not reset.**
- **No working functionality was replaced with a mock.** The local storage driver is a real
  implementation; the S3 driver remains the production path.
- **Migration SQL was not edited** (checksum/immutability).

## Verification (actual results)

| Gate | Command | Result |
| --- | --- | --- |
| Config build | `pnpm --filter @college-erp/config build` | ✅ pass |
| Typecheck | `pnpm --filter @college-erp/api typecheck`, `…worker typecheck`, `pnpm typecheck` (Turbo) | ✅ 35/35 tasks pass |
| Lint | `pnpm --filter @college-erp/{api,worker,config} lint` | ✅ 0 errors API/worker/config (only pre-existing warnings outside touched files) |
| API unit tests | `pnpm --filter @college-erp/api test` | ✅ 57 suites, 392 tests pass |
| Worker unit tests | `pnpm --filter @college-erp/worker test` | ✅ 3 suites, 14 tests pass |
| Storage driver tests | `storage.service.spec` + `storage.local.spec` + `local-storage.controller.spec` | ✅ 19 tests (S3 isolation, local fs round-trip, live HTTP PUT/GET)
| Database validation | `pnpm db:validate` (Prisma) | ✅ schema valid |
| Build | `pnpm build` (Turbo) | ✅ 19/19 tasks |
| E2E / recovery | `pnpm test:e2e`, `pnpm test:recovery` | not run locally — require running PostgreSQL + Redis (pre-existing CI gates, unaffected) |