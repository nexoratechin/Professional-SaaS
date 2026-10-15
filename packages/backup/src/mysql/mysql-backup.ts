/**
 * MySQL logical backup (`mysqldump`).
 *
 * The dump is written as a single, plain-SQL artifact: portable across MySQL 8.x, restorable with
 * the stock `mysql` client, and inspectable as text — which is what makes cheap, per-backup
 * structure verification possible (see `verifyMysqlDump`).
 *
 * Consistency: `--single-transaction` wraps the dump in a repeatable-read snapshot so InnoDB tables
 * are dumped consistently without locking writers.
 */
import { stat } from 'node:fs/promises';
import { computeFileSha256 } from '../manifest';
import { getBinaryVersion, runCommand, runCommandToFile } from '../tools';
import {
  mysqlConnectionArgs,
  mysqlToolEnv,
  parseDatabaseUrl,
  resolveMysqlBinary,
} from './mysql-tools';

export interface MysqlBackupOptions {
  /** Source connection URL. The password is used via MYSQL_PWD, never argv. */
  databaseUrl: string;
  /** Destination file for the SQL dump. Parent directories are created. */
  outputPath: string;
  /** Explicit `mysqldump` path (BACKUP_MYSQLDUMP_PATH). */
  mysqldumpPath?: string;
  /** Explicit `mysql` client path (BACKUP_MYSQL_PATH) — used only for the server-version probe. */
  mysqlPath?: string;
  /** Hard ceiling for the dump (default 30 minutes). */
  timeoutMs?: number;
}

export interface MysqlBackupResult {
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

/** Reads the server version over the `mysql` client. Returns null when unavailable. */
export async function getDatabaseServerVersion(
  databaseUrl: string,
  mysqlPath?: string,
): Promise<string | null> {
  const mysql = resolveMysqlBinary('mysql', mysqlPath);
  if (!mysql) return null;
  try {
    const connection = parseDatabaseUrl(databaseUrl);
    const result = await runCommand(
      mysql,
      [
        ...mysqlConnectionArgs(connection),
        '--batch',
        '--skip-column-names',
        '--database',
        connection.database,
        '--execute',
        'SELECT VERSION()',
      ],
      { env: mysqlToolEnv(connection), timeoutMs: 15_000 },
    );
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Dumps the database to `outputPath` and returns the archive's integrity metadata. The caller owns
 * the file: upload it, verify it, then delete it (the worker does all three).
 */
export async function createMysqlBackup(options: MysqlBackupOptions): Promise<MysqlBackupResult> {
  const startedAt = new Date();
  const mysqldump = resolveMysqlBinary('mysqldump', options.mysqldumpPath);
  if (!mysqldump) {
    throw new Error(
      'mysqldump was not found. Install the MySQL client tools or set BACKUP_MYSQLDUMP_PATH.',
    );
  }
  const connection = parseDatabaseUrl(options.databaseUrl);

  await runCommandToFile(
    mysqldump,
    [
      '--single-transaction',
      '--skip-lock-tables',
      '--routines',
      '--triggers',
      '--no-tablespaces',
      '--default-character-set=utf8mb4',
      ...mysqlConnectionArgs(connection),
      connection.database,
    ],
    {
      outputPath: options.outputPath,
      env: mysqlToolEnv(connection),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  );

  const [fileStat, sha256, toolVersion, serverVersion] = await Promise.all([
    stat(options.outputPath),
    computeFileSha256(options.outputPath),
    getBinaryVersion(mysqldump),
    getDatabaseServerVersion(options.databaseUrl, options.mysqlPath),
  ]);
  const finishedAt = new Date();

  return {
    outputPath: options.outputPath,
    sizeBytes: fileStat.size,
    sha256,
    databaseName: connection.database,
    databaseServerVersion: serverVersion,
    toolVersion,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
