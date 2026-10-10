/**
 * Migration rollback / recovery.
 *
 * Prisma has no `migrate down`: a migration that ran is a fact in `_prisma_migrations`. This script
 * implements the two honest recovery paths:
 *
 *  1. FAILED migration (Prisma error P3009 — the migration crashed mid-way):
 *       pnpm db:migration:rollback -- --resolve-only --migration 20261012000000_add_thing
 *     marks it rolled back, then the next `prisma migrate deploy` can re-apply a fixed version.
 *
 *  2. BAD migration that succeeded (wrong data change, data loss):
 *       pnpm db:migration:rollback -- --backup .backups/pre-migration/pre-migration-<id>.dump --yes
 *     restores the pre-migration snapshot taken by `db:deploy:safe`.
 *
 * Stop the API and worker before restoring (open connections hold locks and would keep serving
 * stale data). See docs/backup-recovery.md § Migration rollback.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  defaultPostgresProbes,
  parseDatabaseUrl,
  restorePostgresBackup,
  runIntegrityProbes,
  verifyPostgresArchive,
} from '@college-erp/backup';

const DATABASE_PACKAGE_DIR = join(__dirname, '..');

function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function prismaMigrateResolve(migration: string): number {
  process.stdout.write(
    `[db:migration:rollback] Marking migration "${migration}" as rolled back (prisma migrate resolve --rolled-back)...\n`,
  );
  const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'resolve', '--rolled-back', migration], {
    cwd: DATABASE_PACKAGE_DIR,
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const migration = flagValue(args, 'migration');

  if (hasFlag(args, 'resolve-only')) {
    if (!migration) throw new Error('--resolve-only requires --migration <name>.');
    process.exit(prismaMigrateResolve(migration));
  }

  const backup = flagValue(args, 'backup');
  if (!backup) {
    throw new Error(
      'Usage: --backup <pre-migration dump> [--target-url <url>] --yes   (or --resolve-only --migration <name>)',
    );
  }
  if (!hasFlag(args, 'yes')) {
    throw new Error(
      'Refusing to restore without --yes: this OVERWRITES the target database with the snapshot. ' +
        'Make sure the API and worker are stopped first.',
    );
  }

  const targetUrl = flagValue(args, 'target-url') ?? process.env.DATABASE_URL;
  if (!targetUrl) throw new Error('DATABASE_URL (or --target-url) is required.');
  const connection = parseDatabaseUrl(targetUrl);

  process.stdout.write(`[db:migration:rollback] Verifying archive ${backup} ...\n`);
  const structure = await verifyPostgresArchive({
    archivePath: backup,
    ...(process.env.BACKUP_PG_RESTORE_PATH ? { pgRestorePath: process.env.BACKUP_PG_RESTORE_PATH } : {}),
  });
  if (!structure.ok) {
    throw new Error(`Archive failed verification (${structure.error ?? 'unknown'}); refusing to restore.`);
  }

  process.stdout.write(
    `[db:migration:rollback] Restoring into ${connection.database}@${connection.host} (clean restore)...\n`,
  );
  const restore = await restorePostgresBackup({
    archivePath: backup,
    targetDatabaseUrl: targetUrl,
    clean: true,
    ...(process.env.BACKUP_PG_RESTORE_PATH ? { pgRestorePath: process.env.BACKUP_PG_RESTORE_PATH } : {}),
  });

  const probes = await runIntegrityProbes({
    databaseUrl: targetUrl,
    probes: defaultPostgresProbes(),
    ...(process.env.BACKUP_PSQL_PATH ? { psqlPath: process.env.BACKUP_PSQL_PATH } : {}),
  });
  const ok = probes.every((probe) => probe.ok);
  process.stdout.write(
    `[db:migration:rollback] Restore ${ok ? 'verified' : 'COMPLETED WITH FAILED PROBES'} in ${restore.durationMs}ms.\n` +
      probes.map((probe) => `  - ${probe.name}: ${probe.value ?? 'error'} ${probe.ok ? 'ok' : 'FAILED'}`).join('\n') +
      '\n',
  );
  if (migration) {
    process.stdout.write(
      `[db:migration:rollback] Note: migration "${migration}" state is now whatever the snapshot contained. ` +
        'If it was a FAILED migration, also run --resolve-only for it before the next deploy.\n',
    );
  }
  process.exit(ok ? 0 : 2);
}

void main().catch((error) => {
  process.stderr.write(`[db:migration:rollback] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
