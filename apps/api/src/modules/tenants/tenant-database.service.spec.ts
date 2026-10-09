import { ConflictException } from '@nestjs/common';
import { TenantDatabaseService } from './tenant-database.service';

function makeService(options: { businessDataCount?: number; mode?: 'SHARED' | 'DEDICATED_SCHEMA' } = {}) {
  const count = options.businessDataCount ?? 0;
  const tenant = {
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme',
    status: 'ACTIVE',
    billingEmail: 'b@acme.test',
    timezone: 'Asia/Kolkata',
    dataIsolationMode: options.mode ?? 'SHARED',
    createdBy: null,
    createdAt: new Date(),
  };

  const platformPrisma = {
    client: {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(tenant),
        findUniqueOrThrow: jest.fn().mockResolvedValue(tenant),
        update: jest.fn().mockResolvedValue({ ...tenant, dataIsolationMode: 'SHARED' }),
      },
      tenantDatabase: {
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { count: jest.fn().mockResolvedValue(count) },
      role: { count: jest.fn().mockResolvedValue(count) },
      campus: { count: jest.fn().mockResolvedValue(0) },
      department: { count: jest.fn().mockResolvedValue(0) },
      program: { count: jest.fn().mockResolvedValue(0) },
      student: { count: jest.fn().mockResolvedValue(0) },
      document: { count: jest.fn().mockResolvedValue(0) },
      notification: { count: jest.fn().mockResolvedValue(0) },
      integration: { count: jest.fn().mockResolvedValue(0) },
    },
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'TENANT_DB_ISOLATION_ENABLED') return true;
      if (key === 'TENANT_DB_SECRET_KEY') return 'a'.repeat(64);
      return undefined;
    }),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const connection = {
    remove: jest.fn(),
    register: jest.fn(),
    ensureRegistered: jest.fn().mockResolvedValue(true),
  };
  const tenantLookup = { invalidate: jest.fn().mockResolvedValue(undefined) };

  const service = new TenantDatabaseService(
    platformPrisma as never,
    config as never,
    audit as never,
    connection as never,
    tenantLookup as never,
  );
  return { service, platformPrisma, config, audit, connection, tenantLookup, tenant };
}

describe('TenantDatabaseService', () => {
  it('reports NOT_APPLICABLE for a shared tenant with no store row', async () => {
    const { service } = makeService();
    const status = await service.getStatus('tenant-1');
    expect(status).toMatchObject({ mode: 'SHARED', status: 'NOT_APPLICABLE', schemaName: null });
  });

  it('refuses to move a tenant that already holds business data', async () => {
    const { service, audit } = makeService({ businessDataCount: 5 });
    await expect(
      service.setDataIsolation('tenant-1', { mode: 'DEDICATED_SCHEMA' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    // Nothing changed and nothing was audited.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reverts an enterprise tenant to SHARED without touching the physical store', async () => {
    const { service, platformPrisma, connection, audit } = makeService({ mode: 'DEDICATED_SCHEMA' });
    await service.setDataIsolation('tenant-1', { mode: 'SHARED' }, 'admin-1');
    expect(platformPrisma.client.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dataIsolationMode: 'SHARED' }) }),
    );
    expect(connection.remove).toHaveBeenCalledWith('tenant-1');
    expect(platformPrisma.client.tenantDatabase.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TENANT_DATA_ISOLATION_CHANGED' }),
    );
  });

  it('reports a manual cutover requirement in the plan when data exists', async () => {
    const { service } = makeService({ businessDataCount: 2 });
    const plan = await service.planIsolationChange('tenant-1', 'DEDICATED_DATABASE');
    expect(plan.requiresManualCutover).toBe(true);
    expect(plan.businessDataCounts.users).toBe(2);
  });
});
