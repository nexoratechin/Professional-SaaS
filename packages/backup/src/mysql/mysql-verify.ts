/**
 * Backup verification and restore (MySQL).
 *
 * Two levels, cheapest first (see docs/backup-recovery.md):
 *  1. `verifyMysqlDump` — streaming-scan the SQL dump to prove it is readable and enumerates the
 *     tables it contains. Runs after every backup; costs milliseconds and needs no client binary.
 *  2. `restoreMysqlBackup` + `runIntegrityProbes` — restore into a scratch database and assert
 *     row counts/schema facts. Scheduled (or on demand); this is the level that proves the backup
 *     actually restores, not merely that it parses.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { runCommandWithInput } from '../tools';
import { createScratchDatabase, toAdminDatabaseUrl } from './mysql';
import { mysqlConnectionArgs, mysqlToolEnv, parseDatabaseUrl, resolveMysqlBinary } from './mysql-tools';

export interface MysqlDumpStructure {
  /** `CREATE TABLE` statements found in the dump (one per table). */
  tableCount: number;
  /** `INSERT INTO` statements found in the dump (rows are usually batched). */
  insertCount: number;
  /** Whether the trailing `-- Dump completed` marker is present (mysqldump always appends it). */
  completed: boolean;
}

/** Streams a dump line-by-line and summarises its structure. Never buffers the whole file. */
export async function scanMysqlDump(dumpPath: string): Promise<MysqlDumpStructure> {
  const structure: MysqlDumpStructure = { tableCount: 0, insertCount: 0, completed: false };
  const reader = createInterface({ input: createReadStream(dumpPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.startsWith('CREATE TABLE ')) structure.tableCount += 1;
    else if (line.startsWith('INSERT INTO ')) structure.insertCount += 1;
    else if (line.startsWith('-- Dump completed')) structure.completed = true;
  }
  return structure;
}

export interface VerifyMysqlDumpOptions {
  dumpPath: string;
  timeoutMs?: number;
}

export interface VerifyMysqlDumpResult {
  ok: boolean;
  dumpPath: string;
  sizeBytes: number;
  tableCount: number;
  insertCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Structure-checks a dump. Never throws for a malformed file — the outcome is the return value so
 * callers can record it in the manifest and metrics.
 */
export async function verifyMysqlDump(
  options: VerifyMysqlDumpOptions,
): Promise<VerifyMysqlDumpResult> {
  const startedAt = Date.now();
  const base = { dumpPath: options.dumpPath, sizeBytes: 0, tableCount: 0, insertCount: 0 };
  let fileStat;
  try {
    fileStat = await stat(options.dumpPath);
  } catch (error) {
    return {
      ...base,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: `Dump is not readable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (fileStat.size === 0) {
    return { ...base, ok: false, durationMs: Date.now() - startedAt, error: 'Dump is empty (0 bytes).' };
  }
  try {
    const structure = await scanMysqlDump(options.dumpPath);
    const ok = structure.tableCount > 0 && structure.completed;
    return {
      ok,
      dumpPath: options.dumpPath,
      sizeBytes: fileStat.size,
      tableCount: structure.tableCount,
      insertCount: structure.insertCount,
      durationMs: Date.now() - startedAt,
      ...(ok
        ? {}
        : {
            error:
              structure.tableCount === 0
                ? 'Dump contains no CREATE TABLE statements; it is not a valid mysqldump.'
                : 'Dump is missing the "-- Dump completed" marker; it was truncated.',
          }),
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

export interface RestoreMysqlBackupOptions {
  dumpPath: string;
  /** Target database to restore INTO (must exist unless `create` is set). */
  targetDatabaseUrl: string;
  mysqlPath?: string;
  /** Drop and recreate the target database before restoring — required over a populated database. */
  clean?: boolean;
  /** Create (dropping any same-named database first) before restoring — recovery-test flow. */
  create?: boolean;
  /** Overrides the maintenance URL derived from the target URL. */
  adminDatabaseUrl?: string;
  timeoutMs?: number;
}

export interface RestoreMysqlBackupResult {
  databaseName: string;
  restoredAt: string;
  durationMs: number;
  created: boolean;
  clean: boolean;
}

/** Restores a dump with the `mysql` client; a partially-restored database must fail loudly. */
export async function restoreMysqlBackup(
  options: RestoreMysqlBackupOptions,
): Promise<RestoreMysqlBackupResult> {
  const startedAt = new Date();
  const mysql = resolveMysqlBinary('mysql', options.mysqlPath);
  if (!mysql) {
    throw new Error('mysql was not found. Install the MySQL client tools or set BACKUP_MYSQL_PATH.');
  }
  const target = parseDatabaseUrl(options.targetDatabaseUrl);
  const adminUrl = options.adminDatabaseUrl ?? toAdminDatabaseUrl(options.targetDatabaseUrl);

  const created = Boolean(options.create);
  const clean = created ? false : options.clean ?? false;
  if (created || clean) {
    // A dump has no CREATE DATABASE/USE (single-database mysqldump), so the client is pointed at an
    // empty, freshly-created schema for a clean restore.
    await createScratchDatabase({
      adminDatabaseUrl: adminUrl,
      name: target.database,
      ...(options.mysqlPath ? { mysqlPath: options.mysqlPath } : {}),
    });
  }

  await runCommandWithInput(
    mysql,
    [
      ...mysqlConnectionArgs(target),
      '--binary-mode',
      '--database',
      target.database,
    ],
    {
      inputPath: options.dumpPath,
      env: mysqlToolEnv(target),
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
