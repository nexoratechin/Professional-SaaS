import { PermissionsService } from '../rbac/permissions.service';
import { ReportsService } from './reports.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import type { AuthenticatedUser } from '@college-erp/auth';

const user: AuthenticatedUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  email: 'admin@example.com',
  fullName: 'Admin',
};

function createService(effective: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const client = {
    reportRun: {
      create: jest.fn().mockResolvedValue({
        id: 'run-1',
        reportType: 'STUDENTS',
        format: 'CSV',
        status: 'QUEUED',
        rowCount: 0,
        fileName: null,
        errorMessage: null,
        createdAt: new Date('2026-09-25T00:00:00.000Z'),
        completedAt: null,
        expiresAt: null,
      }),
    },
    savedReport: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    reportTemplate: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    reportSchedule: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  };
  Object.assign(client.reportRun, overrides.reportRun ?? {});
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const permissions = {
    getEffectivePermissionsWithScope: jest.fn().mockResolvedValue(effective),
    getScopeGrantsFor: jest.fn().mockResolvedValue(effective['reports.view'] ?? []),
  } as unknown as PermissionsService;
  const storage = { getDownloadUrl: jest.fn() } as unknown as StorageService;
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ReportsService(tenantPrisma, permissions, storage, queue as never);
  return { service, client, queue };
}

describe('ReportsService catalog', () => {
  it('only lists definitions the caller can both view and source-access', async () => {
    const { service } = createService({
      'reports.view': [{ scopeType: 'GLOBAL' }],
      'students.view': [{ scopeType: 'GLOBAL' }],
    });
    const catalog = await service.catalog(user);
    expect(catalog.map((entry) => entry.reportType)).toEqual(['STUDENTS']);
  });
});

describe('ReportsService export queue', () => {
  it('creates a tenant-owned run and enqueues the tenant/run payload', async () => {
    const { service, queue } = createService({
      'reports.view': [{ scopeType: 'GLOBAL' }],
      'students.view': [{ scopeType: 'GLOBAL' }],
      'reports.export': [{ scopeType: 'GLOBAL' }],
    });
    const run = await service.createExport(user, { reportType: 'STUDENTS', format: 'CSV', filters: { status: 'ACTIVE' } } as never);
    expect(run).toMatchObject({ id: 'run-1', status: 'QUEUED' });
    expect(queue.add).toHaveBeenCalledWith(
      'generate',
      { tenantId: 'tenant-1', runId: 'run-1' },
      expect.objectContaining({ jobId: 'report-run-1' }),
    );
  });

  it('rejects a report whose source permission is missing', async () => {
    const { service } = createService({
      'reports.view': [{ scopeType: 'GLOBAL' }],
      'reports.export': [{ scopeType: 'GLOBAL' }],
    });
    await expect(service.createExport(user, { reportType: 'STUDENTS', format: 'CSV' } as never)).rejects.toThrow(
      'students.view',
    );
  });
});
