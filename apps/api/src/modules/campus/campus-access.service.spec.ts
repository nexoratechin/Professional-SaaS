import { ForbiddenException } from '@nestjs/common';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { PermissionsService, ScopeGrant } from '../rbac/permissions.service';
import { CampusAccessService } from './campus-access.service';

const TENANT = 't1';
const USER = 'u1';

function makePrisma(departments: Array<{ campusId: string | null }> = [], programs: Array<{ department: { campusId: string | null } | null }> = []) {
  const client = {
    department: { findMany: jest.fn().mockResolvedValue(departments) },
    program: { findMany: jest.fn().mockResolvedValue(programs) },
  };
  return { client, tenantPrisma: { client } as unknown as TenantScopedPrismaService };
}

function makeService(grants: ScopeGrant[]) {
  const { tenantPrisma, client } = makePrisma();
  const permissionsService = {
    getScopeGrantsFor: jest.fn().mockResolvedValue(grants),
  } as unknown as PermissionsService;
  const service = new CampusAccessService(tenantPrisma, permissionsService);
  return { service, permissionsService, client };
}

describe('CampusAccessService.campusIdsFromGrants', () => {
  it('returns null for a GLOBAL grant (unrestricted)', async () => {
    const { service } = makeService([{ scopeType: 'GLOBAL' }]);
    await expect(service.campusIdsFromGrants([{ scopeType: 'GLOBAL' }])).resolves.toBeNull();
  });

  it('returns an empty set when no grants exist (fail closed, never everything)', async () => {
    const { service } = makeService([]);
    const result = await service.campusIdsFromGrants([]);
    expect(result).toBeInstanceOf(Set);
    expect(result!.size).toBe(0);
  });

  it('collects CAMPUS-scoped grants verbatim', async () => {
    const { service } = makeService([]);
    const result = await service.campusIdsFromGrants([
      { scopeType: 'CAMPUS', campusId: 'c1' },
      { scopeType: 'CAMPUS', campusId: 'c2' },
    ]);
    expect(result).toEqual(new Set(['c1', 'c2']));
  });

  it('widens DEPARTMENT-scoped grants up to their campus', async () => {
    const { client } = makePrisma([{ campusId: 'c9' }]);
    const svc = new CampusAccessService(
      { client } as unknown as TenantScopedPrismaService,
      {} as PermissionsService,
    );
    const result = await svc.campusIdsFromGrants([{ scopeType: 'DEPARTMENT', departmentId: 'd1' }]);
    expect(client.department.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1'] } },
      select: { campusId: true },
    });
    expect(result).toEqual(new Set(['c9']));
  });

  it('widens PROGRAM-scoped grants up through their department to the campus', async () => {
    const { client } = makePrisma();
    client.program.findMany.mockResolvedValue([{ department: { campusId: 'c7' } }]);
    const svc = new CampusAccessService(
      { client } as unknown as TenantScopedPrismaService,
      {} as PermissionsService,
    );
    const result = await svc.campusIdsFromGrants([{ scopeType: 'PROGRAM', programId: 'p1' }]);
    expect(result).toEqual(new Set(['c7']));
  });

  it('skips grants that map to no campus', async () => {
    const { client } = makePrisma([{ campusId: null }]);
    client.program.findMany.mockResolvedValue([{ department: null }]);
    const svc = new CampusAccessService(
      { client } as unknown as TenantScopedPrismaService,
      {} as PermissionsService,
    );
    const result = await svc.campusIdsFromGrants([
      { scopeType: 'DEPARTMENT', departmentId: 'dOrphan' },
      { scopeType: 'PROGRAM', programId: 'pOrphan' },
    ]);
    expect(result!.size).toBe(0);
  });

  it('resolveAccessibleCampusIds delegates to getScopeGrantsFor', async () => {
    const { service, permissionsService } = makeService([{ scopeType: 'CAMPUS', campusId: 'c3' }]);
    const result = await service.resolveAccessibleCampusIds(TENANT, USER, 'campus.analytics.view');
    expect(permissionsService.getScopeGrantsFor).toHaveBeenCalledWith(TENANT, USER, 'campus.analytics.view');
    expect(result).toEqual(new Set(['c3']));
  });
});

describe('CampusAccessService.assertCampusAccessible', () => {
  it('allows any campus under GLOBAL scope', async () => {
    const { service } = makeService([{ scopeType: 'GLOBAL' }]);
    await expect(service.assertCampusAccessible(TENANT, USER, 'campus.settings.view', 'whatever')).resolves.toBeUndefined();
  });

  it('allows a campus covered by the caller grants', async () => {
    const { service } = makeService([{ scopeType: 'CAMPUS', campusId: 'c1' }]);
    await expect(service.assertCampusAccessible(TENANT, USER, 'campus.settings.view', 'c1')).resolves.toBeUndefined();
  });

  it('rejects a campus outside the caller grants', async () => {
    const { service } = makeService([{ scopeType: 'CAMPUS', campusId: 'c1' }]);
    await expect(service.assertCampusAccessible(TENANT, USER, 'campus.settings.view', 'c2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects everything when no grants exist', async () => {
    const { service } = makeService([]);
    await expect(service.assertCampusAccessible(TENANT, USER, 'campus.settings.view', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('CampusAccessService.assertGlobalGrant', () => {
  it('accepts a GLOBAL grant', async () => {
    const { service } = makeService([{ scopeType: 'GLOBAL' }]);
    await expect(service.assertGlobalGrant(TENANT, USER, 'campus.policies.manage')).resolves.toBeUndefined();
  });

  it('rejects a CAMPUS-scoped grant (institution-wide policies need GLOBAL scope)', async () => {
    const { service } = makeService([{ scopeType: 'CAMPUS', campusId: 'c1' }]);
    await expect(service.assertGlobalGrant(TENANT, USER, 'campus.policies.manage')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the permission is not held at all', async () => {
    const { service } = makeService([]);
    await expect(service.assertGlobalGrant(TENANT, USER, 'campus.policies.manage')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});