/**
 * Operator CLI for enterprise tenant stores.
 *
 * Enterprise stores are reconciled to the current Prisma schema (see
 * src/tenant-database/migration-executor.ts) rather than by replaying the historical migration
 * files. Run this after every release that changes schema.prisma:
 *
 *   pnpm --filter @college-erp/database tenant:db:list
 *   pnpm --filter @college-erp/database tenant:db:migrate
 *   pnpm --filter @college-erp/database tenant:db:migrate -- --tenant <tenantIdOrSlug>
 *
 * Requires DATABASE_URL and TENANT_DB_SECRET_KEY. Nothing here runs automatically — existing
 * tenants are never migrated implicitly.
 */
import { join } from 'node:path';
import {
  PrismaCliMigrationExecutor,
  TenantDatabaseProvisioner,
  TenantDatabaseSecretCipher,
  descriptorToTarget,
  platformPrismaClient,
  tenantConnectionRegistry,
} from '../src';

interface CliOptions {
  command: 'list' | 'migrate';
  tenant?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const command = (argv[0] ?? 'list') as CliOptions['command'];
  if (command !== 'list' && command !== 'migrate') {
    throw new Error(`Unknown command "${command}" (expected "list" or "migrate").`);
  }
  let tenant: string | undefined;
  const tenantIndex = argv.indexOf('--tenant');
  if (tenantIndex >= 0) {
    tenant = argv[tenantIndex + 1];
    if (!tenant) throw new Error('--tenant requires a value.');
  }
  return { command, tenant };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run this command.`);
  return value;
}

function buildProvisioner(): { provisioner: TenantDatabaseProvisioner; cipher: TenantDatabaseSecretCipher } {
  const sharedUrl = requireEnv('DATABASE_URL');
  const cipher = new TenantDatabaseSecretCipher(requireEnv('TENANT_DB_SECRET_KEY'));
  const schemaPath =
    process.env.TENANT_DB_PRISMA_SCHEMA_PATH ?? join(__dirname, '..', 'prisma', 'schema.prisma');

  const provisioner = new TenantDatabaseProvisioner({
    sharedUrl,
    adminUrl: process.env.TENANT_DB_ADMIN_URL,
    schemaPrefix: process.env.TENANT_DB_SCHEMA_PREFIX ?? 'tenant_',
    databasePrefix: process.env.TENANT_DB_DATABASE_PREFIX ?? 'college_erp_tenant_',
    migrationMode: process.env.TENANT_DB_MIGRATION_MODE === 'manual' ? 'manual' : 'auto',
    migrationExecutor: new PrismaCliMigrationExecutor({ schemaPath }),
  });
  return { provisioner, cipher };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadDescriptors(tenant?: string) {
  const where = tenant
    ? UUID_PATTERN.test(tenant)
      ? { tenantId: tenant }
      : { tenant: { slug: tenant } }
    : { mode: { not: 'SHARED' as const } };
  return platformPrismaClient.tenantDatabase.findMany({
    where,
    include: { tenant: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { provisioner, cipher } = buildProvisioner();

  const descriptors = await loadDescriptors(options.tenant);
  if (descriptors.length === 0) {
    console.log('No enterprise tenant stores found.');
    return;
  }

  if (options.command === 'list') {
    for (const descriptor of descriptors) {
      console.log(
        [
          descriptor.tenant.slug,
          descriptor.tenantId,
          descriptor.mode,
          descriptor.status,
          descriptor.schemaName ?? descriptor.databaseName ?? '-',
          `migrations=${descriptor.appliedMigrationCount}`,
          `last=${descriptor.lastAppliedMigration ?? '-'}`,
        ].join('\t'),
      );
    }
    return;
  }

  for (const descriptor of descriptors) {
    const target = descriptorToTarget(descriptor, cipher);
    if (!target) {
      console.log(`Skipping ${descriptor.tenant.slug}: not READY (status=${descriptor.status}).`);
      continue;
    }

    try {
      await platformPrismaClient.tenantDatabase.update({
        where: { id: descriptor.id },
        data: { status: 'MIGRATING' },
      });
      const result = await provisioner.migrate(target);
      await platformPrismaClient.tenantDatabase.update({
        where: { id: descriptor.id },
        data: {
          status: 'READY',
          appliedMigrationCount: descriptor.appliedMigrationCount + (result.applied ? 1 : 0),
          lastAppliedMigration: result.lastAppliedMigration ?? descriptor.lastAppliedMigration,
          lastMigratedAt: result.applied ? new Date() : descriptor.lastMigratedAt,
          failureReason: null,
        },
      });
      tenantConnectionRegistry.upsert(target);
      console.log(
        result.applied
          ? `Migrated ${descriptor.tenant.slug} (${result.sqlLength} bytes of DDL).`
          : `${descriptor.tenant.slug} already up to date.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await platformPrismaClient.tenantDatabase.update({
        where: { id: descriptor.id },
        data: { status: 'FAILED', failureReason: message },
      });
      console.error(`Failed to migrate ${descriptor.tenant.slug}: ${message}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await platformPrismaClient.$disconnect();
  });
