import { ForbiddenException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { CampusAccessService } from './campus-access.service';
import { CampusAdminService } from './campus-admin.service';

const TENANT = 't1';
const USER = 'u1';
const CAMPUS = 'c1';

const DEFAULT_POLICIES_CONFIG = {
  campusSettingsEnabled: true,
  campusAnalyticsEnabled: true,
  allowCampusAdminRole: true,
  defaultTimezone: null,
};

interface TenantConfigLike {
  id: string;
  tenantId: string;
  version: number;
  config: Record<string, unknown>;
  updatedAt: Date;
}

function tenantConfigDoc(overrides: Record<string, unknown> = {}): TenantConfigLike {
  return {
    id: 'tcfg1',
    tenantId: TENANT,
    version: 4,
    config: { policies: { ...DEFAULT_POLICIES_CONFIG, ...overrides } },
    updatedAt: new Date('2024-06-01T00:00:00Z'),
  };
}

function makeClient() {
  const campus = { findMany: jest.fn().mockResolvedValue([]) };
  const campusConfiguration = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation((args: { data: { campusId: string; data?: unknown } }) => ({
        id: 'cc1',
        tenantId: TENANT,
        campusId: args.data.campusId,
        version: 1,
        data: args.data.data ?? {},
        updatedAt: new Date('2024-06-01T00:00:00Z'),
      })),
    update: jest
      .fn()
      .mockImplementation((args: { data: { version: number; data?: unknown } }) => ({
        id: 'cc1',
        tenantId: TENANT,
        campusId: CAMPUS,
        version: args.data.version,
        data: args.data.data,
        updatedAt: new Date('2024-06-02T00:00:00Z'),
      })),
  };
  const department = { groupBy: jest.fn().mockResolvedValue([]) };
  const student = { groupBy: jest.fn().mockResolvedValue([]) };
  const employee = { groupBy: jest.fn().mockResolvedValue([]) };
  const program = { findMany: jest.fn().mockResolvedValue([]) };
  const studentPayment = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    client: {
      campus,
      campusConfiguration,
      department,
      student,
      employee,
      program,
      studentPayment,
    },
  };
}

function makeService(options: {
  grants?: 'global' | Set<string>;
  tenantConfig?: TenantConfigLike;
} = {}) {
  const { client } = makeClient();
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;

  const campusAccess = {
    resolveAccessibleCampusIds: jest.fn().mockResolvedValue(
      options.grants instanceof Set ? options.grants : options.grants === 'global' ? null : null,
    ),
    assertCampusAccessible: jest.fn().mockResolvedValue(undefined),
  } as unknown as CampusAccessService;

  const tenantConfiguration = {
    get: jest.fn().mockResolvedValue(options.tenantConfig ?? tenantConfigDoc()),
    update: jest.fn().mockResolvedValue(tenantConfigDoc()),
  } as unknown as TenantConfigurationService;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const service = new CampusAdminService(tenantPrisma, campusAccess, tenantConfiguration, auditService);
  return { service, client, campusAccess, tenantConfiguration, auditService };
}

describe('CampusAdminService.overview', () => {
  it('scopes nothing out for GLOBAL access and aggregates tenant-wide counts', async () => {
    const { service, client } = makeService();

    client.campus.findMany.mockResolvedValue([
      { id: 'c1', code: 'MAIN', name: 'Main Campus', city: 'Delhi', state: 'DL', country: 'India', isActive: true, createdAt: new Date('2024-01-01T00:00:00Z') },
    ]);
    client.campusConfiguration.findMany.mockResolvedValue([
      { campusId: 'c1', version: 3, data: { timezone: 'Asia/Kolkata' } },
    ]);
    client.department.groupBy.mockResolvedValue([{ campusId: 'c1', _count: { _all: 2 } }]);
    client.student.groupBy.mockResolvedValue([{ campusId: 'c1', _count: { _all: 50 } }]);
    client.employee.groupBy.mockResolvedValue([{ campusId: 'c1', _count: { _all: 10 } }]);
    client.program.findMany.mockResolvedValue([
      { department: { campusId: 'c1' } },
      { department: { campusId: 'c1' } },
    ]);
    client.studentPayment.findMany.mockResolvedValue([
      { amountCents: 100, student: { campusId: 'c1' } },
    ]);

    const result = await service.overview(TENANT, USER);

    expect(client.campus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    );
    expect(result.campuses).toEqual([
      expect.objectContaining({
        id: 'c1',
        configVersion: 3,
        timezone: 'Asia/Kolkata',
        counts: { departments: 2, programs: 2, students: 50, employees: 10, feeCollectedCents: 100 },
      }),
    ]);
  });

  it('filters campuses to the caller scope when the grants are campus-bound', async () => {
    const { service, client, campusAccess } = makeService({ grants: new Set(['c2']) });

    client.campus.findMany.mockResolvedValue([{ id: 'c2', code: 'C2', name: 'Campus 2', city: null, state: null, country: 'India', isActive: true, createdAt: new Date() }]);

    await service.overview(TENANT, USER);

    expect(campusAccess.resolveAccessibleCampusIds).toHaveBeenCalledWith(TENANT, USER, 'campus.analytics.view');
    expect(client.campus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['c2'] } }) }),
    );
  });

  it('rejects overview when the institution has disabled campus analytics', async () => {
    const { service } = makeService({ tenantConfig: tenantConfigDoc({ campusAnalyticsEnabled: false }) });
    await expect(service.overview(TENANT, USER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CampusAdminService.compare', () => {
  it('rejects a campus outside the caller scope before querying', async () => {
    const { service, campusAccess } = makeService({ grants: new Set(['c1']) });
    (campusAccess.resolveAccessibleCampusIds as jest.Mock).mockResolvedValueOnce(new Set(['c1']));
    await expect(service.compare(TENANT, USER, ['c1', 'c9'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns metrics rows in the requested campus order', async () => {
    const { service, client } = makeService({ grants: new Set(['c1', 'c2']) });

    client.campus.findMany.mockResolvedValue([
      { id: 'c1', code: 'MAIN', name: 'Main', city: 'Delhi' },
      { id: 'c2', code: 'TWO', name: 'Two', city: 'Mumbai' },
    ]);
    client.program.findMany.mockResolvedValue([{ department: { campusId: 'c1' } }]);

    const result = await service.compare(TENANT, USER, ['c2', 'c1']);

    expect(result.campuses.map((c) => c.id)).toEqual(['c2', 'c1']);
    const programs = result.metrics.find((m) => m.metric === 'programs')!;
    expect(programs.values).toEqual([
      { campusId: 'c2', value: 0 },
      { campusId: 'c1', value: 1 },
    ]);
  });
});

describe('CampusAdminService per-campus config', () => {
  it('seeds a fresh campus config from the global defaultTimezone', async () => {
    const { service, client } = makeService({ tenantConfig: tenantConfigDoc({ defaultTimezone: 'Asia/Kolkata' }) });

    const result = await service.getConfig(TENANT, USER, CAMPUS);

    expect(client.campusConfiguration.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, campusId: CAMPUS, data: { timezone: 'Asia/Kolkata' } },
    });
    expect(result.config.timezone).toBe('Asia/Kolkata');
    expect(result.version).toBe(1);
  });

  it('returns the existing document without creating a second row', async () => {
    const { service, client } = makeService();
    client.campusConfiguration.findFirst.mockResolvedValue({
      id: 'cc1',
      tenantId: TENANT,
      campusId: CAMPUS,
      version: 5,
      data: { timezone: 'Asia/Kolkata' },
      updatedAt: new Date(),
    });

    const result = await service.getConfig(TENANT, USER, CAMPUS);

    expect(client.campusConfiguration.create).not.toHaveBeenCalled();
    expect(result.version).toBe(5);
    expect(result.config.timezone).toBe('Asia/Kolkata');
  });

  it('merges PATCH sections, bumps the version and audits the write', async () => {
    const { service, client, auditService } = makeService();
    client.campusConfiguration.findFirst.mockResolvedValue({
      id: 'cc1',
      tenantId: TENANT,
      campusId: CAMPUS,
      version: 5,
      data: { timezone: 'UTC', branding: { primaryColor: '#000000' } },
      updatedAt: new Date(),
    });
    client.campusConfiguration.update.mockResolvedValue({
      id: 'cc1',
      tenantId: TENANT,
      campusId: CAMPUS,
      version: 6,
      data: { timezone: 'Asia/Kolkata', branding: { primaryColor: '#123456' } },
      updatedAt: new Date(),
    });

    await service.updateConfig(TENANT, USER, CAMPUS, {
      timezone: 'Asia/Kolkata',
      branding: { primaryColor: '#123456' } as never,
    } as never);

    expect(client.campusConfiguration.update).toHaveBeenCalledWith({
      where: { id: 'cc1' },
      data: { data: { timezone: 'Asia/Kolkata', branding: { primaryColor: '#123456' } }, version: 6, updatedBy: USER },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        module: AUDIT_MODULES.CAMPUS,
        action: AUDIT_ACTIONS.CAMPUS_CONFIGURATION_UPDATED,
        entityType: 'CampusConfiguration',
        entityId: 'cc1',
        before: expect.objectContaining({ version: 5 }),
        after: expect.objectContaining({ version: 6 }),
      }),
    );
  });

  it('explicit null clears the timezone override', async () => {
    const { service, client } = makeService();
    client.campusConfiguration.findFirst.mockResolvedValue({
      id: 'cc1',
      tenantId: TENANT,
      campusId: CAMPUS,
      version: 1,
      data: { timezone: 'Asia/Kolkata' },
      updatedAt: new Date(),
    });

    await service.updateConfig(TENANT, USER, CAMPUS, { timezone: null } as never);

    expect(client.campusConfiguration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ data: expect.objectContaining({ timezone: null }) }),
      }),
    );
  });

  it('rejects config edits when the institution has disabled campus settings', async () => {
    const { service } = makeService({ tenantConfig: tenantConfigDoc({ campusSettingsEnabled: false }) });
    await expect(service.updateConfig(TENANT, USER, CAMPUS, { timezone: 'UTC' } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('CampusAdminService policies', () => {
  it('getPolicies merges the tenant document with defaults for missing keys', async () => {
    const { service } = makeService({ tenantConfig: tenantConfigDoc({ campusAnalyticsEnabled: false }) });

    const result = await service.getPolicies(TENANT);

    expect(result.policies).toEqual({
      campusSettingsEnabled: true,
      campusAnalyticsEnabled: false,
      allowCampusAdminRole: true,
      defaultTimezone: null,
    });
  });

  it('getPolicies returns full defaults when no policies section exists yet', async () => {
    const { service } = makeService({
      tenantConfig: {
        id: 'tcfg1',
        tenantId: TENANT,
        version: 1,
        config: {},
        updatedAt: new Date(),
      },
    });

    const result = await service.getPolicies(TENANT);
    expect(result.policies).toEqual(DEFAULT_POLICIES_CONFIG);
  });

  it('updatePolicies writes through the tenant configuration engine and audits', async () => {
    const { service, tenantConfiguration, auditService } = makeService();

    (tenantConfiguration.update as jest.Mock).mockResolvedValue(
      tenantConfigDoc({ campusAnalyticsEnabled: false, defaultTimezone: 'Asia/Kolkata' }),
    );

    await service.updatePolicies(TENANT, USER, { campusAnalyticsEnabled: false });

    expect(tenantConfiguration.update).toHaveBeenCalledWith(TENANT, { policies: { campusAnalyticsEnabled: false } }, USER);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        module: AUDIT_MODULES.CAMPUS,
        action: AUDIT_ACTIONS.CAMPUS_POLICIES_UPDATED,
        entityType: 'TenantConfiguration',
      }),
    );
  });
});