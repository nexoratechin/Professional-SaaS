/**
 * Safe migration deploy: pre-migration backup -> verify -> `prisma migrate deploy`.
 *
 * Why a wrapper instead of plain `prisma migrate deploy` in production: Prisma has no down
 * migrations, so the only honest rollback for a migration that changes data is a pre-migration
 * database snapshot. This script takes and verifies one first, writes its manifest next to it, and
 * refuses to migrate if the backup cannot be verified — a failed backup is a failed deploy, before
 * anything touched production.
 *
 *   pnpm --filter @college-erp/database db:deploy:safe
 *   pnpm --filter @college-erp/database db:deploy:safe -- --dir D:\backups\prod
 *
 * Rollback, if needed (see docs/backup-recovery.md § Migration rollback):
 *   pnpm db:migration:rollback -- --backup <file> --yes
 *
 * Requires DATABASE_URL and the PostgreSQL client tools (pg_dump/pg_restore) on PATH.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBackupId,
  createBackupManifest,
  createPostgresBackup,
  parseDatabaseUrl,
  serializeBackupManifest,
  verifyPostgresArchive,
} from '@college-erp/backup';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const DATABASE_PACKAGE_DIR = join(__dirname, '..');

function flagValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const databaseUrl = flagValue(args, 'url') ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL (or --url) is required.');

  const outputDir = flagValue(args, 'dir') ?? process.env.BACKUP_LOCAL_DIR ?? join(REPO_ROOT, '.backups', 'pre-migration');
  mkdirSync(outputDir, { recursive: true });

  const id = buildBackupId();
  const outputPath = join(outputDir, `pre-migration-${id}.dump`);
  const connection = parseDatabaseUrl(databaseUrl);
  const environment = process.env.BACKUP_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';

  process.stdout.write(`[db:deploy:safe] Taking pre-migration backup -> ${outputPath}\n`);
  const backup = await createPostgresBackup({
    databaseUrl,
    outputPath,
    ...(process.env.BACKUP_PG_DUMP_PATH ? { pgDumpPath: process.env.BACKUP_PG_DUMP_PATH } : {}),
  });
  process.stdout.write(
    `[db:deploy:safe] Backup complete: ${(backup.sizeBytes / 1024 / 1024).toFixed(2)} MiB, sha256=${backup.sha256}\n`,
  );

  const verification = await verifyPostgresArchive({
    archivePath: outputPath,
    ...(process.env.BACKUP_PG_RESTORE_PATH ? { pgRestorePath: process.env.BACKUP_PG_RESTORE_PATH } : {}),
  });
  if (!verification.ok) {
    throw new Error(
      `[db:deploy:safe] ABORTING: pre-migration backup failed verification (${verification.error ?? 'unknown'}). ` +
        'Nothing was migrated. Do not delete the archive until the failure is understood.',
    );
  }
  process.stdout.write(
    `[db:deploy:safe] Backup verified: ${verification.tableCount} table(s), ${verification.tableDataEntries} table-data entries.\n`,
  );

  const manifest = createBackupManifest({
    id,
    kind: 'POSTGRES_FULL',
    format: 'pg-custom',
    environment,
    databaseName: connection.database,
    objectKey: outputPath,
    sizeBytes: backup.sizeBytes,
    sha256: backup.sha256,
    ...(backup.toolVersion ? { toolVersion: backup.toolVersion } : {}),
    verification: {
      verifiedAt: new Date().toISOString(),
      method: 'toc',
      ok: true,
      tableCount: verification.tableCount,
      durationMs: verification.durationMs,
    },
    metadata: { purpose: 'pre-migration' },
  });
  const manifestPath = `${outputPath}.manifest.json`;
  writeFileSync(manifestPath, serializeBackupManifest(manifest));

  process.stdout.write('[db:deploy:safe] Applying migrations (prisma migrate deploy)...\n');
  const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: DATABASE_PACKAGE_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    process.stderr.write(
      `[db:deploy:safe] Migration FAILED (exit ${result.status ?? 'unknown'}).\n` +
        `[db:deploy:safe] Emergency rollback command:\n` +
        `  pnpm db:migration:rollback -- --backup "${outputPath}" --yes\n`,
    );
    process.exit(result.status ?? 1);
  }

  process.stdout.write(
    `[db:deploy:safe] Migrations applied. Pre-migration backup retained at:\n` +
      `  archive:  ${outputPath}\n  manifest: ${manifestPath}\n` +
      `[db:deploy:safe] Rollback (if needed): pnpm db:migration:rollback -- --backup "${outputPath}" --yes\n`,
  );
}

void main().catch((error) => {
  process.stderr.write(`[db:deploy:safe] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
