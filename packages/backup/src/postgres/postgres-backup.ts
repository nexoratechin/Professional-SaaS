/**
 * PostgreSQL logical backup (`pg_dump --format=custom`).
 *
 * Custom format is deliberate: it is compressed, supports parallel restore, selective restore, and
 * `pg_restore --list` — which is what makes cheap, per-backup structure verification possible
 * without restoring anything.
 */
import { stat } from 'node:fs/promises';
import {
  getBinaryVersion,
  parseDatabaseUrl,
  pgToolEnv,
  resolvePgBinary,
  runCommand,
  runCommandToFile,
} from './pg-tools';
import { computeFileSha256 } from '../manifest';

export interface PostgresBackupOptions {
  /** Source connection URL. The password is used via PGPASSWORD, never argv. */
  databaseUrl: string;
  /** Destination file for the custom-format archive. Parent directories are created. */
  outputPath: string;
  /** Explicit `pg_dump` path (BACKUP_PG_DUMP_PATH). */
  pgDumpPath?: string;
  /** 0-9; defaults to 6. Ignored when the build has no compression support. */
  compressLevel?: number;
  /** Hard ceiling for the dump (default 30 minutes). */
  timeoutMs?: number;
}

export interface PostgresBackupResult {
  outputPath: string;
  sizeBytes: number;
  sha256: string;
  databaseName: string;
  databaseServerVersion: string | null;
  toolVersion: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Reads the server version over `psql`-free `pg_dump --version` is not enough — this uses the
 *  archive's server_version only where available. Kept as a small hook for metadata richness. */
export async function getDatabaseServerVersion(databaseUrl: string, psqlPath?: string): Promise<string | null> {
  const psql = resolvePgBinary('psql', psqlPath);
  if (!psql) return null;
  try {
    const connection = parseDatabaseUrl(databaseUrl);
    const result = await runCommand(psql, ['--no-align', '--tuples-only', '--dbname', connection.sanitizedUrl, '--command', 'SHOW server_version'], {
      env: pgToolEnv(connection),
      timeoutMs: 15_000,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Dumps the database to `outputPath` and returns the archive's integrity metadata. The caller owns
 * the file: upload it, verify it, then delete it (the worker does all three).
 */
export async function createPostgresBackup(options: PostgresBackupOptions): Promise<PostgresBackupResult> {
  const startedAt = new Date();
  const pgDump = resolvePgBinary('pg_dump', options.pgDumpPath);
  if (!pgDump) {
    throw new Error(
      'pg_dump was not found. Install the PostgreSQL client tools (postgresql-client) or set BACKUP_PG_DUMP_PATH.',
    );
  }
  const connection = parseDatabaseUrl(options.databaseUrl);
  const compressLevel = Math.min(Math.max(options.compressLevel ?? 6, 0), 9);

  await runCommandToFile(
    pgDump,
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--compress=${compressLevel}`,
      `--file=${options.outputPath}`,
      '--dbname',
      connection.sanitizedUrl,
    ],
    {
      outputPath: options.outputPath,
      env: pgToolEnv(connection),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  );

  const [fileStat, sha256, toolVersion] = await Promise.all([
    stat(options.outputPath),
    computeFileSha256(options.outputPath),
    getBinaryVersion(pgDump),
  ]);
  const finishedAt = new Date();

  return {
    outputPath: options.outputPath,
    sizeBytes: fileStat.size,
    sha256,
    databaseName: connection.database,
    databaseServerVersion: null,
    toolVersion,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
