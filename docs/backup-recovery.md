# Backup & disaster recovery

Production backup, verification, restore and rollback strategy for the College ERP SaaS. Implemented
by `@college-erp/backup` (framework-agnostic primitives) and the worker's `backup` queue (scheduling,
object storage, heartbeat, retention) — no new infrastructure services: backups ride on PostgreSQL,
Redis and the existing S3/MinIO bucket.

```
┌─ worker ──────────────────────────────────────────────────────────────────────────────┐
│  backup scheduler (BACKUP_INTERVAL_HOURS, default 24h)                                │
│    ├─ postgres-backup  pg_dump -Fc ─▶ pg_restore --list verify ─▶ [restore-verify]    │
│    │                   ─▶ upload archive + manifest to s3://<bucket>/backups/…        │
│    │                   ─▶ Redis heartbeat (last success) ─▶ GFS retention prune       │
│    ├─ redis-snapshot   BGSAVE + persistence audit ─▶ redis-cli --rdb export ─▶ upload │
│    └─ backup-prune     daily GFS retention sweep                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
        │ heartbeat key obs:backup:last_success:postgres
        ▼
┌─ API ──────────────────────────────────────────────────────────────────────────────────┐
│  alert engine: backup_stale (WARNING past BACKUP_MAX_AGE_HOURS, CRITICAL past 2×)      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. Objectives

| Metric | Target | Mechanism |
|---|---|---|
| **RPO — PostgreSQL** | ≤ 24 h (default; tune with `BACKUP_INTERVAL_HOURS`) | scheduled `pg_dump` to object storage |
| **RPO — PostgreSQL (managed deployments)** | ≤ 5 min (recommended) | enable the provider's continuous WAL archiving/PITR on top of these logical backups |
| **RPO — Redis** | ≤ 1 s (AOF), ≤ 6 h (off-host RDB) | AOF `everysec` + RDB save points on a persistent volume; scheduled RDB export to S3 |
| **RPO — documents (S3/MinIO)** | 0 (source of truth) / replication lag | bucket versioning + mirror/replication (see §9) |
| **RTO — full PostgreSQL restore** | ≤ 60 min for the current dataset sizes; re-measure per environment | restore runbook §6, pre-pulled restore image, tested quarterly |
| **RTO — single tenant disaster** | ≤ 60 min | restore-to-scratch then extract tenant rows (§6.3) |
| **RTO — Redis** | ≤ 15 min | restart with AOF/RDB volume, or accept rebuild (queues are re-derivable, §8) |
| **Backup verification** | every backup (structure) + weekly restore-verify | §4 |

These targets are operational goals, not contractual guarantees; measure them with the automated
recovery test (§14) and adjust the table when the environment changes.

## 2. Backup frequency & retention

| Artifact | Frequency (default) | Retention (GFS) | Where |
|---|---|---|---|
| PostgreSQL full dump | every `BACKUP_INTERVAL_HOURS` (24 h) | 7 daily + 4 weekly + 12 monthly (`BACKUP_RETENTION_*`) | `s3://$S3_BUCKET/backups/<env>/postgres/…` |
| Backup manifest (JSON) | with every dump | with its dump | next to the archive (`*.manifest.json`) |
| Redis snapshot (BGSAVE heartbeat, optional RDB) | every `BACKUP_REDIS_INTERVAL_HOURS` (6 h) | same GFS policy | `s3://$S3_BUCKET/backups/<env>/redis/…` |
| Migration pre-backup | every `db:deploy:safe` run | operator-managed (`.backups/pre-migration/` or `--dir`) | local disk / ops share |
| Document objects | continuous (bucket versioning) | per bucket policy | MinIO/S3 |

Retention is enforced by the daily `backup-prune` job using a pure GFS planner
(`planRetention` in `packages/backup/src/retention.ts`, unit-tested): the newest backup of each of
the last N days, then each of the last W ISO weeks, then each of the last M months. The newest
backup overall is never deleted.

## 3. How PostgreSQL backups work

1. **Dump** — `pg_dump --format=custom --no-owner --no-privileges --compress=6` streams straight to
   a temp file (never buffered in memory); the password travels via `PGPASSWORD`, never argv.
2. **Structure verification** — always: `pg_restore --list` must parse the archive TOC (tables +
   table data present). A dump that cannot be listed is a failed backup.
3. **Restore verification** (optional, `BACKUP_VERIFY_RESTORE_ENABLED=true`) — restore into a
   scratch database (`college_erp_recovery_<id>`), run integrity probes
   (`_prisma_migrations` complete, no unfinished migrations, `tenants`/`users` readable), then drop
   the scratch database. Failing probes fail the job.
4. **Upload** — archive + manifest (id, size, SHA-256, tool version, verification result) to S3.
5. **Heartbeat** — `obs:backup:last_success:postgres` is set in Redis (90-day TTL); the API's
   `backup_stale` alert reads it.
6. **Prune** — GFS retention (above) including the matching manifests.

An archive that fails verification is never uploaded as a backup, and the failure lands on the
dead-letter queue where the existing `dead_letter_backlog` alert pages. The manifest's `sha256` is
recomputed before every restore; a mismatch refuses the restore.

## 4. Verification levels

| Level | Command | Cost | Cadence |
|---|---|---|---|
| Structure (TOC) | automatic in `postgres-backup`; manual: `pnpm backup:verify -- --archive <file>` | ms | every backup |
| Restore + probes | `BACKUP_VERIFY_RESTORE_ENABLED=true`; manual: `pnpm backup:verify -- --archive <file> --restore --target-url <scratch> --create-db` | minutes | weekly+ recommended |
| Automated recovery test | `pnpm test:recovery` | minutes | CI on every change; scheduled quarterly drill |

## 5. Restore procedures

### 5.1 Full restore (disaster recovery)

Prerequisites: the archive (download from object storage with `mc cp`, `aws s3 cp`, or a presigned
URL), `pg_restore` on PATH (or in the API/worker image), and a maintenance window.

```bash
# 0. Freeze the platform: stop api and worker so nothing writes during the restore.
docker compose stop api worker

# 1. Identify the latest verified archive and its manifest.
#    Object layout: backups/<env>/postgres/<yyyy>/<mm>/<dd>/<id>.dump (+ .manifest.json)
mc ls --recursive local/college-erp-documents/backups/production/postgres/ | tail -5
mc cp local/college-erp-documents/backups/production/postgres/2026/10/10/<id>.dump ./restore.dump

# 2. Verify BEFORE restoring (structure + checksum from the manifest).
pnpm backup:verify -- --archive ./restore.dump   # exit code 2 = do not proceed

# 3. Take a safety snapshot of the CURRENT database (so the restore itself is reversible).
pnpm backup:postgres -- --out ./pre-restore.dump

# 4. Restore into the primary database (--clean drops/recreates objects; --yes confirms).
pnpm backup:restore -- --archive ./restore.dump --target-url "$DATABASE_URL" --clean --yes

# 5. Start the platform and complete the post-restore checklist (below).
docker compose start api worker
```

The restore command runs the default integrity probes after `pg_restore --exit-on-error`, so a
partially applied restore fails loudly instead of serving broken data.

**Post-restore checklist**

- [ ] `GET /health/ready` reports database + Redis + storage healthy.
- [ ] Login works for a known platform admin and a known tenant admin (JWT keys unchanged).
- [ ] Spot-check 3 tenants: latest student/fee/payment rows match the backup timestamp.
- [ ] Re-enqueue or reconcile work stranded during the outage: check the dead-letter queue and
      `payment-reconciliation`/`notifications` queues; BullMQ jobs already persisted in Redis
      before the freeze will resume.
- [ ] Re-record the recovery point (which RPO was actually met) in the incident log.
- [ ] Trigger an immediate fresh backup (`POST` via operator CLI: `pnpm backup:postgres`) so the
      RPO clock restarts from the restored state.

### 5.2 Point-in-time recovery (managed PostgreSQL)

Logical dumps restore to the dump's instant. If the deployment runs on a managed PostgreSQL with
continuous WAL archiving enabled, use the provider's PITR for minute-level RPO and keep these
logical dumps as the last line of defence. Confirm PITR/PITR-window settings during every quarterly
drill; they are provider-managed and not configured by this repository.

### 5.3 Single-tenant recovery (shared schema)

A tenant damaging its own data does not justify restoring the whole platform. Instead:

1. Restore the archive into a scratch database (`pnpm backup:verify -- --archive … --restore --create-db --target-url … --keep-scratch`).
2. Extract the tenant's rows from the scratch database:
   `\copy (SELECT * FROM <table> WHERE tenant_id = '<id>') TO 'tenant_rows.csv' CSV HEADER`.
3. Apply them to production through the tenant's normal imports (`@college-erp/imports` CSV flow) or
   a reviewed, tenant-scoped SQL script — never raw `COPY` into shared tables without a transaction
   and an audit note.
4. Drop the scratch database.

### 5.4 Single-tenant recovery (dedicated database/schema)

Enterprise tenants provisioned with `DEDICATED_*` isolation (`docs/enterprise-database-isolation.md`)
can be restored in place: restore their dump over their dedicated database only. The shared dump
still contains their registry row; do not overwrite the shared database.

## 6. Migration rollback strategy

Prisma has no `migrate down`; the honest rollback for data-changing migrations is the pre-migration
snapshot.

| Situation | Action |
|---|---|
| Deploying schema changes | `pnpm db:deploy:safe` — takes + verifies a pre-migration backup, **aborts the deploy if the backup fails**, then runs `prisma migrate deploy`. The archive path is printed for rollback. |
| Migration crashed mid-run (Prisma P3009) | `pnpm db:migration:rollback -- --resolve-only --migration <name>` then fix and redeploy. |
| Migration succeeded but is wrong/data-lossy | Stop api+worker, `pnpm db:migration:rollback -- --backup <pre-migration dump> --yes`, fix the migration, redeploy through `db:deploy:safe`. |
| Migration only added nullable columns/tables | Rolling forward with a follow-up migration is often cheaper than restoring; use the snapshot only when data correctness is at stake. |

Rules for writing migrations so rollback stays possible:

- **Expand/contract**: ship additive changes first (new nullable columns/tables), backfill, switch
  reads, then remove old structures in a later release. Each step is independently deployable.
- Never combine destructive DDL and destructive DML in one migration.
- Test migrations against a restored production dump (`pnpm backup:verify --restore --create-db`)
  before applying to production.

## 7. Redis recovery strategy

Redis holds derived state — the recovery position is documented rather than row-by-row:

| Class | Loss impact | Recovery |
|---|---|---|
| BullMQ queues | jobs not yet processed are lost | Re-derivable: job state lives in PostgreSQL (import rows, invoices, documents). Re-enqueue through the source API or resubmit; inspect the dead-letter queue after availability resumes. |
| Cache / idempotency / rate-limit keys | transient duplication risk (idempotency window) | Rebuild naturally; clients retry with the same `Idempotency-Key`. |
| Worker heartbeats, window counters | alert blind spots for one interval | Regenerated within `WORKER_HEARTBEAT_INTERVAL_MS`. |

Persistence (configured in `docker-compose.yml`): AOF `everysec` + RDB save points on the
`redis_data` volume, so a plain Redis/container restart loses at most ~1 s of writes.

Off-host recovery:

1. The worker's `redis-snapshot` job runs every `BACKUP_REDIS_INTERVAL_HOURS` (default 6 h) and:
   triggers `BGSAVE`, audits the persistence state (`aof_enabled`, `rdb_last_bgsave_status`,
   `aof_last_write_status`, last-save age), and — when `redis-cli` is available — exports the RDB to
   `backups/<env>/redis/…` with a manifest.
2. To restore: stop the worker, place the exported RDB as `/data/dump.rdb` in the Redis volume
   (`docker compose cp <file> redis:/data/dump.rdb`), restart Redis.
3. If AOF is also present, Redis prefers AOF on startup; either remove `/data/appendonlydir` or
   accept that AOF is the newer state (usually what you want).
4. Verify: `redis-cli INFO persistence` shows `loading:0`, `rdb_last_bgsave_status:ok`.
5. If the RDB is unusable or stale, do nothing: restart Redis empty and re-enqueue pending work
   from PostgreSQL. This is a valid recovery — say so explicitly in the incident log.

## 8. Document/object storage backups

Documents are the source of truth in the bucket; back up the bucket itself:

- **Versioning** on the documents bucket (MinIO/S3) so an overwritten/deleted object is recoverable.
- **Mirror/replication** to a second bucket or region (`mc mirror --overwrite local/college-erp-documents remote/…`
  or the provider's bucket replication). Schedule this alongside the PostgreSQL backups.
- The database dump restores the *metadata* (document rows, keys, versions); objects must come from
  the bucket backup. A restore without bucket replication gives you metadata pointing at missing
  files — practice the pair together in drills.
- Encrypt bucket replicas at rest (SSE / MinIO KMS) — dumps contain personal data.

## 9. Secrets and configuration

Dumps **do not** include environment secrets (JWT keypair, `*_SECRET_KEY`s, VAPID). Protect them
separately or a perfect restore still cannot start:

- Store all `.env` values in a secret manager; back it up with its own provider guarantees.
- Keep an offline copy of: `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (rotating them logs everyone out),
  `MFA_ENCRYPTION_KEY`, `DEVICE_SECRET_KEY`, `NOTIFICATION_SECRET_KEY`, `INTEGRATION_SECRET_KEY`,
  `TENANT_DB_SECRET_KEY`, VAPID keys, platform/admin bootstrap credentials.
- A restore with the *wrong* key leaves encrypted columns undecryptable: restore the key set from
  the same point in time as the dump.

## 10. Monitoring & alerting

| Signal | Where |
|---|---|
| `college_erp_backup_operations_total{kind,outcome}` | worker `/metrics` |
| `college_erp_backup_last_success_timestamp_seconds{kind}` | worker `/metrics` (page when `time() - value > RPO`) |
| `college_erp_backup_verifications_total{kind,method,result}` | worker `/metrics` |
| `backup_stale` rule | API alert engine (WARNING past `BACKUP_MAX_AGE_HOURS`, CRITICAL past 2×, CRITICAL when never recorded) |
| backup job failures → dead-letter queue | existing `dead_letter_backlog` / `dead_letter_moves` alerts |

Set `BACKUP_EXPECTED=true` wherever the scheduler runs (docker-compose default) so the alert can
page. Suggested Prometheus rule (mirrors the in-app alert):

```yaml
- alert: CollegeErpBackupStale
  expr: time() - college_erp_backup_last_success_timestamp_seconds{kind="postgres"} > 26*3600
  for: 15m
  labels: { severity: critical }
  annotations:
    summary: "PostgreSQL backups are behind schedule (RPO at risk)"
```

## 11. Emergency procedure

**Severity guide** — declare a recovery incident when: data corruption/loss is confirmed or
suspected, the primary database is unrecoverable, a bad migration touched production data, or the
backup heartbeat has been CRITICAL for more than two windows.

**First 15 minutes**

1. **Stop writes, keep evidence.** `docker compose stop api worker` (or scale to 0). Do not restart
   the database yet; preserve the current state for diagnosis.
2. **Declare and assign.** Incident commander, scribe (timestamps!), one operator per action. Open
   a channel; record the last-known-good time (the RPO decision point).
3. **Classify** — corrupt data (needs restore or surgical repair) vs unavailable infrastructure
   (needs failover/restart) vs application bug (fix forward). Only the first needs a restore; a
   restart is not a restore.
4. **Snapshot before touching anything.** `pg_dump` the damaged database if it is still readable
   (`pnpm backup:postgres -- --out ./incident-<date>.dump`) — the forensic copy may recover data
   the last scheduled backup missed, and you cannot dump what you overwrote.

**Decision tree**

```
Data incorrect? ── no ──▶ infrastructure/application fix (restart, failover, patch) → verify → resume
      │ yes
      ▼
Extent?
 ├─ one tenant, limited tables ──▶ tenant-scoped repair/extract from verified backup (§5.3)
 └─ widespread corruption ──▶ full restore to the newest VERIFIED archive (§5.1)
        │
        ▼
     Restore verified? ── no ──▶ try next-oldest archive; if none verify → escalate;
                                  reconstruct from WAL/PITR if the provider has it
        │ yes
        ▼
     Post-restore checklist (§5.1) → resume traffic → fresh backup → write incident report
```

**Recovery targets to hit**

- T+15 min: platform frozen, incident declared, last-known-good time chosen, forensic copy started.
- T+45 min: chosen archive verified and downloaded.
- T+Z (RTO): restore complete, probes pass, api+worker resumed.
- T+Z+15: fresh backup taken; heartbeat green; `backup_stale` resolved.

**Afterwards** — blameless postmortem within 5 business days: actual RPO/RTO vs targets, what the
plan got wrong, whether a drill would have caught it, and concrete backlog items (this document
included). A recovery strategy is only real if it is rehearsed: run the automated recovery test at
least quarterly against a production-size copy.

## 12. Automated recovery tests

`packages/backup/test/recovery.e2e-spec.ts` exercises the full loop against a real PostgreSQL:
fixture data → `pg_dump` → manifest checksum → `pg_restore --list` → restore into a scratch
database → integrity probes compare source/restore → verification detects a forced mismatch →
cleanup. It self-skips when the tools/database are absent.

```bash
# Local: against the docker-compose Postgres (never production).
RECOVERY_TEST_DATABASE_URL=postgresql://college_erp:college_erp_dev_password@localhost:5432/college_erp \
  pnpm test:recovery

# CI runs the same suite on every push/PR — see .github/workflows/ci.yml.
# Debugging: set RECOVERY_KEEP_SCRATCH=true to keep the restored scratch database.
```

Unit suites (`packages/backup/src/**/*.spec.ts`) cover retention planning, manifest validation,
connection-string handling, TOC parsing and Redis persistence assessment — these run in the normal
`pnpm turbo run test` pipeline.

## 13. Environment reference

| Variable | Default | Purpose |
|---|---|---|
| `BACKUP_ENABLED` (worker) | `false` (compose: `true`) | master switch for scheduled backup jobs |
| `BACKUP_ENVIRONMENT` | `NODE_ENV` | environment segment in object keys |
| `BACKUP_S3_PREFIX` | `backups` | object-key prefix |
| `BACKUP_INTERVAL_HOURS` | `24` | full-backup cadence (RPO driver) |
| `BACKUP_VERIFY_RESTORE_ENABLED` | `false` | restore into scratch DB + probes per backup |
| `BACKUP_SCRATCH_DATABASE_URL` | derived | admin URL used for scratch databases |
| `BACKUP_SCRATCH_DATABASE_PREFIX` | `college_erp_recovery_` | scratch DB prefix |
| `BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY` | `7/4/12` | GFS retention |
| `BACKUP_TIMEOUT_MS` | `1800000` | per-tool timeout |
| `BACKUP_PG_DUMP_PATH` / `BACKUP_PG_RESTORE_PATH` / `BACKUP_PSQL_PATH` | PATH | explicit client-tool paths |
| `BACKUP_REDIS_ENABLED` | `true` | scheduled Redis snapshots |
| `BACKUP_REDIS_INTERVAL_HOURS` | `6` | Redis snapshot cadence |
| `BACKUP_REDIS_RDB_EXPORT_ENABLED` | `true` | export RDB to object storage |
| `BACKUP_REDIS_CLI_PATH` | PATH | explicit `redis-cli` path |
| `BACKUP_REDIS_MAX_AGE_HOURS` | `26` | snapshot freshness budget (worker assessment) |
| `BACKUP_EXPECTED` (api) | `false` (compose: `true`) | whether `backup_stale` alerts |
| `BACKUP_MAX_AGE_HOURS` (api) | `26` | RPO budget the alert compares against |

Operator commands (run from the repo root):

| Command | Effect |
|---|---|
| `pnpm backup:postgres` | dump `DATABASE_URL` to `.backups/` and structure-verify it |
| `pnpm backup:verify -- --archive <file> [--restore --target-url <url> --create-db]` | verify structure, optionally restore + probe |
| `pnpm backup:restore -- --archive <file> --target-url <url> --clean --yes` | restore (overwrites target) |
| `pnpm backup:redis [-- --out <file.rdb>]` | BGSAVE + audit, optional RDB export |
| `pnpm test:recovery` | automated recovery test |
| `pnpm db:deploy:safe` | pre-migration backup → `prisma migrate deploy` |
| `pnpm db:migration:rollback -- --backup <file> --yes` | restore a pre-migration snapshot |
| `pnpm db:migration:rollback -- --resolve-only --migration <name>` | mark a failed migration rolled back (P3009) |

## 14. Drill schedule

| Drill | Cadence | Owner |
|---|---|---|
| CI recovery test | every push/PR | CI |
| Restore production dump into staging + probe | monthly | platform engineer |
| Full DR exercise (declare, restore, checklist, timings) | quarterly | on-call + platform |
| Redis empty-restart + re-enqueue exercise | quarterly | platform engineer |
| Secrets-restore exercise (prove keys are recoverable) | semi-annual | security owner |
