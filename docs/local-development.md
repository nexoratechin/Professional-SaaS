# Local development (no Docker)

This project runs entirely on your machine with native runtimes and locally installed services.
Docker is not used anywhere — no Dockerfiles, no Compose, no container services.

The stack:

| Piece | What runs it locally | Default URL / port |
| --- | --- | --- |
| `apps/web` (React + Vite PWA) | Vite dev server | http://localhost:5173 |
| `apps/api` (NestJS REST API) | Node (`nest start --watch`) | http://localhost:3000 |
| `apps/worker` (BullMQ worker) | Node (`nest start --watch`) | health/metrics on http://localhost:3100 |
| `packages/database` (Prisma) | Prisma CLI | PostgreSQL |
| PostgreSQL | Native Windows service | `localhost:5432` |
| Redis | Memurai / WSL / native Redis | `localhost:6379` |
| Object storage (documents) | Native MinIO server | `localhost:9000` (console `:9001`) |

Node.js `>=20` and pnpm are required. The repo declares `packageManager: pnpm@9.12.0`; enable
Corepack so the pinned version is used:

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

## 1. Install dependencies

From the repository root:

```bash
pnpm install
```

## 2. PostgreSQL (required)

The API, worker and Prisma all need PostgreSQL.

**Windows** — install the official installer (you already have `postgresql-x64-17` running as a
service), then create the app role and database once. Using the bundled `psql`:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -p 5432
```

```sql
CREATE ROLE college_erp LOGIN PASSWORD 'college_erp_dev_password' CREATEDB;
CREATE DATABASE college_erp OWNER college_erp;
```

Start / stop the service:

```powershell
Start-Service postgresql-x64-17
Stop-Service  postgresql-x64-17
```

**macOS** (Homebrew): `brew install postgresql@16 && brew services start postgresql@16`
**Linux** (Debian/Ubuntu): `sudo apt-get install -y postgresql && sudo systemctl start postgresql`

Verify connectivity:

```bash
psql "postgresql://college_erp:college_erp_dev_password@localhost:5432/college_erp" -c "select 1;"
```

The connection string lives in `apps/api/.env`, `apps/worker/.env` and `packages/database/.env`
(`DATABASE_URL`). Adjust the password/database if yours differ.

## 3. Redis (required for the API and worker)

Redis backs BullMQ queues, caching, rate limiting, idempotency and observability windows.

Windows options:

- **Memurai** (Redis-compatible, recommended on Windows) — install from
  <https://www.memurai.com/get-memurai>; it runs as a Windows service on `localhost:6379`.
- **WSL2** — `wsl --install`, then inside WSL: `sudo apt-get install -y redis-server && sudo service redis-server start`.
- **Docker is not required** — do not use the archived Redis-for-Windows build in production.

macOS: `brew install redis && brew services start redis`
Linux: `sudo apt-get install -y redis-server && sudo systemctl start redis-server`

Verify:

```bash
redis-cli -h localhost -p 6379 ping   # → PONG
```

The URL lives in `apps/api/.env` and `apps/worker/.env` (`REDIS_URL=redis://localhost:6379`).

> The API alone (read-only endpoints) and the web app can start without Redis, but any
> BullMQ-backed feature and the worker need it. The API is not silently mocked if Redis is down:
> `/health/ready` reports Redis as critical.

## 4. Object storage — MinIO / S3 (needed for document features)

Document upload/download, HR payslips, report exports, brand assets and backups use the shared
S3-compatible `StorageService`. The API/worker talk to a real S3-compatible endpoint; there is no
local-filesystem storage driver, so run MinIO natively to exercise those features.

**Windows** — download `minio.exe` (and `mc.exe`) from <https://min.io/docs/minio/container/index.html>
or the MinIO downloads page, then:

```powershell
# Console/credentials default to localhost:9000 / :9001
$env:MINIO_ROOT_USER="college_erp_minio"
$env:MINIO_ROOT_PASSWORD="college_erp_minio_password"
.\minio.exe server C:\minio-data --console-address ":9001"

# In another shell, create the bucket:
.\mc.exe alias set local http://localhost:9000 college_erp_minio college_erp_minio_password
.\mc.exe mb local/college-erp-documents
```

macOS/Linux: `brew install minio/stable/minio mc` or the official binary, then the same
`minio server` + `mc mb` steps.

Settings live in `apps/api/.env` and `apps/worker/.env` (`S3_ENDPOINT`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true`). For production, point these at your
managed S3-compatible provider — the abstraction is unchanged.

## 5. Environment files

Each app loads its own `.env` (gitignored). Copy the examples and fill in secrets:

```bash
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example    apps/web/.env
```

Rules:

- `NOTIFICATION_SECRET_KEY` and `INTEGRATION_SECRET_KEY` must be **identical** in
  `apps/api/.env` and `apps/worker/.env` (the worker decrypts what the API encrypts).
- Generate every `*_SECRET_KEY` and the JWT keypair with real values — never commit them.
- `apps/web/.env` holds `VITE_API_URL` (default `http://localhost:3000`).

## 6. Database setup with Prisma

```bash
pnpm db:generate     # generate Prisma Client
pnpm db:validate     # validate the schema
pnpm db:migrate      # apply migrations in development (prisma migrate dev)
pnpm db:deploy:safe  # safer path: pre-migration backup → prisma migrate deploy
pnpm db:seed         # seed the global catalog + platform admin (+ demo data off-prod)
```

- Migrations and existing data are **never** reset or dropped by these commands.
- `db:deploy:safe` takes a pre-migration backup first; it needs `pg_dump` on PATH.
- On a fresh database use `db:migrate`; on an existing one use `db:deploy:safe` (or
  `pnpm --filter @college-erp/database exec prisma migrate deploy`).

## 7. Run the apps

Each app runs independently (three terminals), or all at once with Turbo.

```bash
# All at once (Turbo, parallel)
pnpm dev

# Individually
pnpm dev:web      # http://localhost:5173
pnpm dev:api      # http://localhost:3000
pnpm dev:worker   # worker + health on :3100
```

Production-style run (after building):

```bash
pnpm build            # turbo build across the workspace
pnpm start:api        # node apps/api/dist/main.js
pnpm start:worker     # node apps/worker/dist/main.js
pnpm build:web        # static PWA build → apps/web/dist
pnpm start:web        # vite preview of the built PWA
```

## 8. Tests, lint, typecheck

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e         # API e2e — needs PostgreSQL + Redis running
pnpm test:recovery    # backup → verify → restore (needs pg_dump/pg_restore/psql)
```

Unit tests do not need external services. The API e2e suite and the recovery test do — start
PostgreSQL and Redis first.

## Troubleshooting

- **`prisma migrate` can't connect** — confirm PostgreSQL is running and `DATABASE_URL` matches,
  and that the `college_erp` role/database exist (§2).
- **API `/health/ready` reports Redis down** — start Redis (§3). The API still boots without it.
- **Document upload fails** — start MinIO and create the `college-erp-documents` bucket (§4).
- **`pnpm` uses the wrong version** — run `corepack enable` so the pinned `pnpm@9.12.0` is used.
