import {
  TenantDatabaseProvisioner,
  type TenantAdminSqlRunner,
} from './provisioner';

const SHARED_URL = 'postgresql://u:p@localhost:5432/shared';

function makeProvisioner(overrides: {
  migrationMode?: 'auto' | 'manual';
  migrationSql?: string;
  databaseExists?: boolean;
}) {
  const executed: string[] = [];
  const applied: Array<{ url: string; sql: string }> = [];
  const provisioner = new TenantDatabaseProvisioner({
    sharedUrl: SHARED_URL,
    schemaPrefix: 'tenant_',
    databasePrefix: 'college_erp_tenant_',
    migrationMode: overrides.migrationMode ?? 'auto',
    migrationExecutor: {
      generateMigrationSql: async () => overrides.migrationSql ?? 'CREATE TABLE "x"();',
      applySql: async (url, sql) => {
        applied.push({ url, sql });
      },
    },
    adminSqlRunnerFactory: (): TenantAdminSqlRunner => ({
      execute: async (sql) => {
        executed.push(sql);
      },
      queryExists: async () => overrides.databaseExists ?? false,
      dispose: async () => undefined,
    }),
  });
  return { provisioner, executed, applied };
}

describe('TenantDatabaseProvisioner', () => {
  it('does nothing for SHARED tenants', async () => {
    const { provisioner, executed, applied } = makeProvisioner({});
    const result = await provisioner.provision({ tenantId: 't1', slug: 'acme', mode: 'SHARED' });
    expect(result).toMatchObject({ mode: 'SHARED', connectionUrl: SHARED_URL, schemaName: null });
    expect(executed).toHaveLength(0);
    expect(applied).toHaveLength(0);
  });

  it('creates a schema and applies migrations for DEDICATED_SCHEMA', async () => {
    const { provisioner, executed, applied } = makeProvisioner({});
    const result = await provisioner.provision({
      tenantId: 't1',
      slug: 'acme-college',
      mode: 'DEDICATED_SCHEMA',
    });
    expect(executed[0]).toBe('CREATE SCHEMA IF NOT EXISTS "tenant_acme_college"');
    expect(result.schemaName).toBe('tenant_acme_college');
    expect(new URL(result.connectionUrl).searchParams.get('schema')).toBe('tenant_acme_college');
    expect(applied).toHaveLength(1);
    expect(result.migrationsApplied).toBe(true);
  });

  it('creates a database only when it does not already exist', async () => {
    const created = makeProvisioner({ databaseExists: false });
    const first = await created.provisioner.provision({ tenantId: 't1', slug: 'acme', mode: 'DEDICATED_DATABASE' });
    expect(created.executed.some((sql) => sql.startsWith('CREATE DATABASE'))).toBe(true);
    expect(new URL(first.connectionUrl).pathname).toBe('/college_erp_tenant_acme');

    const existing = makeProvisioner({ databaseExists: true });
    await existing.provisioner.provision({ tenantId: 't1', slug: 'acme', mode: 'DEDICATED_DATABASE' });
    expect(existing.executed.some((sql) => sql.startsWith('CREATE DATABASE'))).toBe(false);
  });

  it('skips migrations in manual mode but still creates the store', async () => {
    const { provisioner, executed, applied } = makeProvisioner({ migrationMode: 'manual' });
    const result = await provisioner.provision({
      tenantId: 't1',
      slug: 'acme',
      mode: 'DEDICATED_SCHEMA',
    });
    expect(executed[0]).toContain('CREATE SCHEMA');
    expect(applied).toHaveLength(0);
    expect(result.migrationsApplied).toBe(false);
  });

  it('treats an up-to-date store as no-op when migrating', async () => {
    const { provisioner, applied } = makeProvisioner({ migrationSql: '   ' });
    const result = await provisioner.migrate({
      tenantId: 't1',
      mode: 'DEDICATED_SCHEMA',
      connectionUrl: SHARED_URL,
      schemaName: 'tenant_x',
      databaseName: null,
    });
    expect(result.applied).toBe(false);
    expect(applied).toHaveLength(0);
  });
});
