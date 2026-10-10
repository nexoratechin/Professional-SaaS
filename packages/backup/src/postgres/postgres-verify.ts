/**
 * Backup verification and restore.
 *
 * Two levels, cheapest first (see docs/backup-recovery.md):
 *  1. `verifyPostgresArchive` — `pg_restore --list` proves the archive is readable and enumerates
 *     the tables it contains. Runs after every backup; costs milliseconds.
 *  2. `restorePostgresBackup` + `runIntegrityProbes` — restore into a scratch database and assert
 *     row counts/schema facts. Scheduled (or on demand); this is the level that proves the backup
 *     actually restores, not merely that it parses.
 */
import { stat } from 'node:fs/promises';
import { parseDatabaseUrl, pgToolEnv, resolvePgBinary, runCommand } from './pg-tools';
import { createScratchDatabase, toAdminDatabaseUrl } from './psql';

export interface PgRestoreToc {
  /** Total TOC entries reported by `pg_restore --list`. */
  entries: number;
  /** `TABLE DATA` entries (one per table with data in the dump). */
  tableDataEntries: number;
  /** `TABLE` entries (one per table definition). */
  tableEntries: number;
}

/**
 * Parses `pg_restore --list` output. Format per line:
 *   `215; 1259 16385 TABLE public students postgres`
 * where the type column may contain a space (`TABLE DATA`, `MATERIALIZED VIEW DATA`, ...).
 * Counting by substring keeps this parser stable across PostgreSQL versions.
 */
export function parsePgRestoreToc(text: string): PgRestoreToc {
  let entries = 0;
  let tableDataEntries = 0;
  let tableEntries = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\d+;\s/.test(line)) continue;
    entries += 1;
    // ` TABLE DATA ` must be tested before ` TABLE ` (prefix overlap).
    if (line.includes(' TABLE DATA ')) {
      tableDataEntries += 1;
    } else if (line.includes(' TABLE ')) {
      tableEntries += 1;
    }
  }
  return { entries, tableDataEntries, tableEntries };
}

export interface VerifyPostgresArchiveOptions {
  archivePath: string;
  pgRestorePath?: string;
  timeoutMs?: number;
}

export interface VerifyPostgresArchiveResult {
  ok: boolean;
  archivePath: string;
  sizeBytes: number;
  tableCount: number;
  tableDataEntries: number;
  entries: number;
  durationMs: number;
  error?: string;
}

/**
 * Structure-checks an archive with `pg_restore --list`. Never throws for a malformed file — the
 * outcome is the return value so callers can record it in the manifest and metrics.
 */
export async function verifyPostgresArchive(
  options: VerifyPostgresArchiveOptions,
): Promise<VerifyPostgresArchiveResult> {
  const startedAt = Date.now();
  const base = {
    archivePath: options.archivePath,
    sizeBytes: 0,
    tableCount: 0,
    tableDataEntries: 0,
    entries: 0,
  };
  let fileStat;
  try {
    fileStat = await stat(options.archivePath);
  } catch (error) {
    return {
      ...base,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: `Archive is not readable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (fileStat.size === 0) {
    return { ...base, ok: false, durationMs: Date.now() - startedAt, error: 'Archive is empty (0 bytes).' };
  }
  const pgRestore = resolvePgBinary('pg_restore', options.pgRestorePath);
  if (!pgRestore) {
    return {
      ...base,
      sizeBytes: fileStat.size,
      ok: false,
      durationMs: Date.now() - startedAt,
      error:
        'pg_restore was not found. Install the PostgreSQL client tools or set BACKUP_PG_RESTORE_PATH.',
    };
  }
  try {
    const result = await runCommand(pgRestore, ['--list', options.archivePath], {
      timeoutMs: options.timeoutMs ?? 120_000,
    });
    const toc = parsePgRestoreToc(result.stdout);
    const ok = toc.entries > 0;
    return {
      ok,
      archivePath: options.archivePath,
      sizeBytes: fileStat.size,
      tableCount: toc.tableEntries,
      tableDataEntries: toc.tableDataEntries,
      entries: toc.entries,
      durationMs: Date.now() - startedAt,
      ...(ok ? {} : { error: 'pg_restore --list returned no TOC entries; the archive is not a valid dump.' }),
    };
  } catch (error) {
    return {
      ...base,
      sizeBytes: fileStat.size,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface RestorePostgresBackupOptions {
  archivePath: string;
  /** Target database to restore INTO (must exist unless `create` is set). */
  targetDatabaseUrl: string;
  pgRestorePath?: string;
  /** Drop objects before recreating them — required when restoring over a populated database. */
  clean?: boolean;
  /** Create (dropping any same-named database first) before restoring — recovery-test flow. */
  create?: boolean;
  /** Overrides the maintenance URL derived from the target URL. */
  adminDatabaseUrl?: string;
  /** Explicit `psql` path used when `create` is set. */
  psqlPath?: string;
  timeoutMs?: number;
}

export interface RestorePostgresBackupResult {
  databaseName: string;
  restoredAt: string;
  durationMs: number;
  created: boolean;
  clean: boolean;
}

/** Restores an archive with `--exit-on-error`: a partially-restored database must fail loudly. */
export async function restorePostgresBackup(
  options: RestorePostgresBackupOptions,
): Promise<RestorePostgresBackupResult> {
  const startedAt = new Date();
  const pgRestore = resolvePgBinary('pg_restore', options.pgRestorePath);
  if (!pgRestore) {
    throw new Error(
      'pg_restore was not found. Install the PostgreSQL client tools (postgresql-client) or set BACKUP_PG_RESTORE_PATH.',
    );
  }
  const target = parseDatabaseUrl(options.targetDatabaseUrl);
  const adminUrl = options.adminDatabaseUrl ?? toAdminDatabaseUrl(options.targetDatabaseUrl);

  const created = Boolean(options.create);
  if (created) {
    await createScratchDatabase({
      adminDatabaseUrl: adminUrl,
      name: target.database,
      ...(options.psqlPath ? { psqlPath: options.psqlPath } : {}),
    });
  }

  const clean = created ? false : options.clean ?? false;
  await runCommand(
    pgRestore,
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      ...(clean ? ['--clean', '--if-exists'] : []),
      '--dbname',
      target.sanitizedUrl,
      options.archivePath,
    ],
    {
      env: pgToolEnv(target),
      timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
    },
  );

  return {
    databaseName: target.database,
    restoredAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    created,
    clean,
  };
}
