# Local development (no Docker)

This project runs entirely on your machine with native runtimes and locally installed services.
Docker is not used anywhere — no Dockerfiles, no Compose, no container services.

The stack:

| Piece | What runs it locally | Default URL / port |
| --- | --- | --- |
| `apps/web` (React + Vite PWA) | Vite dev server | http://localhost:5173 |
| `apps/api` (NestJS REST API) | Node (`nest start --watch`) | http://localhost:3000 |
| `apps/worker` (BullMQ worker) | Node (`nest start --watch`) | health/metrics on http://localhost:3100 |
| `packages/database` (Prisma) | Prisma CLI | MySQL |
| MySQL | Native Windows service | `localhost:3306` |
| Redis | Memurai / WSL / native Redis | `localhost:6379` |
| Object storage (documents) | Local filesystem (default) — no server needed | `.data/storage` in the repo |

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

## 2. MySQL (required)

The API, worker and Prisma all need MySQL 8.

**Windows** — install the official MySQL 8 installer (it installs the `MySQL80` service on port
`3306`), then create the app user and database once. Using the bundled `mysql` client:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

```sql
CREATE USER 'college_erp'@'localhost' IDENTIFIED BY 'college_erp_dev_password';
CREATE DATABASE college_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON college_erp.* TO 'college_erp'@'localhost';
FLUSH PRIVILEGES;
```

Start / stop the service:

```powershell
Start-Service MySQL80
Stop-Service  MySQL80
```

**macOS** (Homebrew): `brew install mysql && brew services start mysql`
**Linux** (Debian/Ubuntu): `sudo apt-get install -y mysql-server && sudo systemctl start mysql`

Verify connectivity:

```bash
mysql "mysql://college_erp:college_erp_dev_password@localhost:3306/college_erp" -e "select 1;"
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

## 4. Object storage (no MinIO needed for local development)

Document uploads/downloads, HR payslips, report exports and brand assets go through the shared
`StorageService`. Which backing store it uses is selected by `STORAGE_DRIVER`:

- **`local` (default in the committed `.env.example`)** — objects are written to a directory on
  your machine (`.data/storage/<bucket>/…`, relative to the repo root). **No MinIO or S3 server is
  required.** The API mints short-lived signed URLs that stream bytes through its own
  `/storage/local/*` endpoint; the worker reads/writes the same directory. This is ideal for local
  development but is not durable across machines or redeploys.
- **`s3`** — talks to any S3-compatible endpoint. Use a local MinIO for development if you want to
  exercise the S3 path, or point it at a managed provider (AWS S3, R2, …) in production. Production
  should always use `s3`; local disk is not durable there.

Nothing else in the stack changes between drivers — the tenant-prefix isolation, signed URLs and
document metadata checks are the same.

```bash
# Local filesystem (default) — nothing to install:
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=.data/storage

# S3-compatible (e.g. MinIO locally, a managed provider in production):
STORAGE_DRIVER=s3
S3_ENDPOINT=https://your-endpoint
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_BUCKET=college-erp-documents
S3_FORCE_PATH_STYLE=true
```

Settings live in `apps/api/.env` and `apps/worker/.env`. The two apps must use the same driver (and
the same `STORAGE_LOCAL_DIR` when local), because the worker processes the objects the API stores.


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
- `db:deploy:safe` takes a pre-migration backup first; it needs `mysqldump` and `mysql` on PATH.
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
pnpm test:e2e         # API e2e — needs MySQL + Redis running
pnpm test:recovery    # backup → verify → restore (needs mysqldump/mysql clients)
```

Unit tests do not need external services. The API e2e suite and the recovery test do — start
MySQL and Redis first.

## Troubleshooting

- **`prisma migrate` can't connect** — confirm MySQL is running and `DATABASE_URL` matches,
  and that the `college_erp` user/database exist (§2).
- **API `/health/ready` reports Redis down** — start Redis (§3). The API still boots without it.
- **Document upload fails** — with `STORAGE_DRIVER=local` check that `.data/storage` is writable;
  with `STORAGE_DRIVER=s3` check the `S3_*` settings and that the bucket exists.
- **`pnpm` uses the wrong version** — run `corepack enable` so the pinned `pnpm@9.12.0` is used.
