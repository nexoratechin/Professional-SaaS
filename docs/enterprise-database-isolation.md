# Enterprise database isolation

The platform's default data-isolation model is **shared PostgreSQL + `tenant_id`**: every
tenant-owned table carries a required, indexed, FK'd `tenant_id`, and
`packages/database/src/client.ts` enforces that filter mechanically (a Prisma extension derived
from the Prisma DMMF, not per-model hand-written code).

Enterprise customers can opt into stronger physical isolation. This is configurable per tenant
and does **not** change the default for anyone:

| Mode | Physical store | When to use |
| --- | --- | --- |
| `SHARED` (default) | Shared database, rows filtered by `tenant_id` | Everyone, unless they ask otherwise |
| `DEDICATED_SCHEMA` | The tenant's tables live in their own Postgres schema in the shared database | Enterprise tenants who need logical isolation without a separate DB |
| `DEDICATED_DATABASE` | The tenant's tables live in their own Postgres database | Enterprise tenants with a regulatory/contractual requirement for physical separation |

The mode is stored on `tenants.data_isolation_mode` (fast path for request routing) and the
physical-store metadata on the `tenant_databases` table (connection URL encrypted at rest,
provisioning status, last migration).

## How request routing works

`createTenantScopedClient(tenantId)` (used by every domain service via `TenantScopedPrismaService`,
and directly by the worker) consults `TenantConnectionRegistry`:

- No entry (or `SHARED`) → the shared client, exactly as before.
- A `DEDICATED_*` entry → a pooled `PrismaClient` bound to that tenant's schema/database, still
  wrapped with the same tenant-guard extension (defence in depth: the guard keeps applying even
  when the store holds a single tenant).

`PlatformPrismaService` always stays on the shared control-plane database (tenants, platform
users, subscriptions, invoices, audit). Enterprise stores are full copies of the schema, so
control-plane tables physically exist there but are never used for control-plane reads.

The registry is populated:

- per request, by `TenantLookupService`/`TenantConnectionService` when an enterprise tenant is
  resolved (a `DEDICATED_*` tenant whose store is not `READY` is rejected with `503`, so it can
  never silently fall back to the shared database);
- at startup and on an interval, by both `apps/api` and `apps/worker`.

## Provisioning

Provisioning is the `TenantDatabaseProvisioner` abstraction in `packages/database`:

1. `SHARED` → no-op.
2. `DEDICATED_SCHEMA` → `CREATE SCHEMA IF NOT EXISTS`, then a schema-scoped connection URL.
3. `DEDICATED_DATABASE` → `CREATE DATABASE`, then a connection URL pointing at the new database.

Both dedicated modes are then brought up to the current Prisma schema and seeded with the global
catalog (permissions, feature flags, plans, plan modules, billing config) plus the tenant's own
`tenants` row, so the store is self-consistent and its foreign keys resolve.

## Migration strategy for enterprise stores

Enterprise stores do **not** replay the historical `prisma/migrations` files. That history is
`public`-schema-qualified in places (e.g. `20260928000000_fix_actor_id_columns`) and is written
for the shared database. Instead the store is reconciled against the current `schema.prisma`:

- **Baseline / apply** — `prisma migrate diff --from-url <store> --to-schema-datamodel
  prisma/schema.prisma --script` produces exactly the DDL the store is missing (the full schema
  for an empty store, a delta for an existing one), and `prisma db execute --file <sql> --url
  <store>` applies it. This is idempotent: an up-to-date store yields empty SQL.
- **On every release** an operator runs `pnpm --filter @college-erp/database tenant:db:migrate`
  (all enterprise stores) or `... tenant:db:migrate -- --tenant <id>` (one store). The API also
  exposes `POST /tenants/:id/database/migrate` for a single store.
- `TENANT_DB_MIGRATION_MODE=manual` makes provisioning create the store without applying
  migrations, so a DBA can apply them out-of-band; `auto` (default) applies them inline.

## Existing tenants are never migrated automatically

Existing tenants remain `SHARED` forever unless an operator explicitly provisions a store for
them. `GET /tenants/:id/data-isolation/plan` returns a read-only cutover plan. Moving a tenant
that already holds business data to a dedicated store is a deliberate, operator-run procedure
(provision the store, then copy the tenant's rows with the operator's Postgres tooling during a
maintenance window) — the API refuses to flip an existing tenant with data automatically so it
can never half-move a live tenant.

## Configuration

See `apps/api/.env.example` (`TENANT_DB_*`). Enterprise isolation is off unless
`TENANT_DB_ISOLATION_ENABLED=true` and `TENANT_DB_SECRET_KEY` is set.
