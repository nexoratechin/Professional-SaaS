/**
 * Operator CLI for backup/restore/recovery — the manual counterpart to the worker's scheduled
 * backup jobs. Run through package scripts so DATABASE_URL / REDIS_URL come from the environment:
 *
 *   pnpm backup:mysql                             # dump DATABASE_URL to .backups/
 *   pnpm backup:verify -- --archive .backups/x.sql
 *   pnpm backup:verify -- --archive x.sql --restore --target-url mysql://.../scratch --create-db
 *   pnpm backup:restore -- --archive x.sql --target-url mysql://.../college_erp --clean --yes
 *   pnpm backup:redis -- --out .backups/redis.rdb
 *
 * See docs/backup-recovery.md for the full runbook.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildBackupId,
  createMysqlBackup,
  dropDatabase,
  parseDatabaseUrl,
  RedisRecoveryManager,
  restoreMysqlBackup,
  runIntegrityProbes,
  defaultMysqlProbes,
  verifyMysqlDump,
} from '../src';

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const command = argv[0] ?? 'help';
  const flags: Flags = {};
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg || !arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function booleanFlag(flags: Flags, name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

function requireFlag(flags: Flags, name: string, envFallback?: string): string {
  const value = stringFlag(flags, name) ?? envFallback;
  if (!value) throw new Error(`--${name} is required (or set ${envFallback ? envFallback : name}).`);
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Optional explicit `mysql` client path from --mysql-path or BACKUP_MYSQL_PATH. */
function mysqlPathFlag(flags: Flags): { mysqlPath?: string } {
  const value = stringFlag(flags, 'mysql-path') ?? process.env.BACKUP_MYSQL_PATH;
  return value ? { mysqlPath: value } : {};
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'mysql') {
    const databaseUrl = requireFlag(flags, 'url', 'DATABASE_URL');
    const outDir = stringFlag(flags, 'out-dir') ?? process.env.BACKUP_LOCAL_DIR ?? '.backups';
    await mkdir(outDir, { recursive: true });
    const outputPath = stringFlag(flags, 'out') ?? join(outDir, `mysql-${buildBackupId()}.sql`);
    const backup = await createMysqlBackup({
      databaseUrl,
      outputPath,
      ...(stringFlag(flags, 'mysqldump-path') ?? process.env.BACKUP_MYSQLDUMP_PATH
        ? { mysqldumpPath: stringFlag(flags, 'mysqldump-path') ?? process.env.BACKUP_MYSQLDUMP_PATH }
        : {}),
      ...mysqlPathFlag(flags),
    });
    const verification = await verifyMysqlDump({ dumpPath: backup.outputPath });
    printJson({ backup, verification });
    if (!verification.ok) {
      process.exitCode = 2;
      process.stderr.write(`Backup verification FAILED: ${verification.error ?? 'unknown reason'}\n`);
    }
    return;
  }

  if (command === 'verify') {
    const archive = requireFlag(flags, 'archive');
    const structure = await verifyMysqlDump({ dumpPath: archive });
    if (!booleanFlag(flags, 'restore')) {
      printJson({ structure });
      if (!structure.ok) process.exitCode = 2;
      return;
    }
    const targetUrl = requireFlag(flags, 'target-url');
    const create = booleanFlag(flags, 'create-db');
    const probes = defaultMysqlProbes();
    const connection = parseDatabaseUrl(targetUrl);
    const restore = await restoreMysqlBackup({
      dumpPath: archive,
      targetDatabaseUrl: targetUrl,
      create,
      ...(create ? { adminDatabaseUrl: stringFlag(flags, 'admin-url') } : {}),
      ...mysqlPathFlag(flags),
    });
    const probeResults = await runIntegrityProbes({
      databaseUrl: targetUrl,
      probes,
      ...mysqlPathFlag(flags),
    });
    const ok = probeResults.every((probe) => probe.ok);
    if (create && !booleanFlag(flags, 'keep-scratch')) {
      const adminUrl =
        stringFlag(flags, 'admin-url') ??
        (() => {
          const url = new URL(targetUrl);
          url.pathname = '/information_schema';
          return url.toString();
        })();
      await dropDatabase({
        adminDatabaseUrl: adminUrl,
        name: connection.database,
        ...mysqlPathFlag(flags),
      });
    }
    printJson({ structure, restore, probes: probeResults, ok });
    if (!ok || !structure.ok) process.exitCode = 2;
    return;
  }

  if (command === 'restore') {
    const archive = requireFlag(flags, 'archive');
    const targetUrl = requireFlag(flags, 'target-url', 'DATABASE_URL');
    const confirmed = booleanFlag(flags, 'yes');
    if (!confirmed) {
      process.stderr.write(
        'Refusing to restore without --yes: this OVERWRITES the target database. ' +
          'Take a safety backup first (pnpm backup:mysql) if it holds live data.\n',
      );
      process.exitCode = 1;
      return;
    }
    const structure = await verifyMysqlDump({ dumpPath: archive });
    if (!structure.ok) {
      printJson({ structure });
      process.stderr.write(`Archive failed structure verification; refusing to restore: ${structure.error}\n`);
      process.exitCode = 2;
      return;
    }
    const restore = await restoreMysqlBackup({
      dumpPath: archive,
      targetDatabaseUrl: targetUrl,
      clean: !booleanFlag(flags, 'no-clean'),
      ...mysqlPathFlag(flags),
    });
    const probes = await runIntegrityProbes({
      databaseUrl: targetUrl,
      probes: defaultMysqlProbes(),
      ...mysqlPathFlag(flags),
    });
    printJson({ restore, probes });
    process.exitCode = probes.every((probe) => probe.ok) ? 0 : 2;
    return;
  }

  if (command === 'redis') {
    const redisUrl = stringFlag(flags, 'url') ?? process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL or --url is required.');
    const manager = new RedisRecoveryManager({
      redisUrl,
      ...(stringFlag(flags, 'redis-cli-path') ?? process.env.BACKUP_REDIS_CLI_PATH
        ? { redisCliPath: stringFlag(flags, 'redis-cli-path') ?? process.env.BACKUP_REDIS_CLI_PATH }
        : {}),
    });
    try {
      const snapshot = await manager.snapshot({});
      const out = stringFlag(flags, 'out');
      const exportResult = out ? await manager.exportRdb({ outputPath: out }) : null;
      printJson({ snapshot, export: exportResult });
      if (!snapshot.ok) process.exitCode = 2;
    } finally {
      await manager.close();
    }
    return;
  }

  process.stderr.write(
    [
      'Usage: backup-cli.ts <mysql|verify|restore|redis> [flags]',
      '',
      '  mysql    [--url <url>] [--out <file>] [--out-dir <dir>]',
      '  verify   --archive <file> [--restore --target-url <url> [--create-db] [--admin-url <url>]]',
      '  restore  --archive <file> --target-url <url> --yes [--no-clean]',
      '  redis    [--url <redisUrl>] [--out <rdbFile>]',
      '',
      'See docs/backup-recovery.md.',
    ].join('\n') + '\n',
  );
  process.exitCode = command === 'help' ? 0 : 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
