/**
 * PermissionsService — hierarchical RBAC resolution: UserRole -> RolePermission -> Permission
 * with MANAGE action inheritance and scope-carrying grants, plus the Redis cache/invalidation.
 * Mocked tenant-scoped client + Redis (no DB).
 */
import type Redis from 'ioredis';
import { ACTIONS_IMPLIED_BY_MANAGE, PERMISSION_ACTIONS } from '@college-erp/auth';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PermissionsService } from './permissions.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

function makeService() {
  const client = {
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    permission: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const service = new PermissionsService(tenantPrisma, redis as unknown as Redis);
  return { service, client, redis };
}

describe('PermissionsService.getEffectivePermissionsWithScope', () => {
  it('maps role permissions to scope-carrying grants', async () => {
    const { service, client, redis } = makeService();
    client.userRole.findMany.mockResolvedValue([
      {
        scopeCampusId: 'c1',
        scopeDepartmentId: null,
        scopeProgramId: null,
        role: {
          rolePermissions: [
            { scopeType: 'CAMPUS', permission: { key: 'students.view', module: 'students', action: 'VIEW' } },
          ],
        },
      },
    ]);

    const result = await service.getEffectivePermissionsWithScope(TENANT, USER);
    expect(result['students.view']).toEqual([
      { scopeType: 'CAMPUS', campusId: 'c1', departmentId: undefined, programId: undefined },
    ]);
    // Result is cached for the tenant/user pair.
    expect(redis.set).toHaveBeenCalledWith(`perms:${TENANT}:${USER}`, expect.any(String), 'EX', 300);
  });

  it('expands a MANAGE grant into every implied action on the same module/scope', async () => {
    const { service, client } = makeService();
    client.userRole.findMany.mockResolvedValue([
      {
        scopeCampusId: null,
        scopeDepartmentId: 'd1',
        scopeProgramId: null,
        role: {
          rolePermissions: [{ scopeType: 'DEPARTMENT', permission: { key: 'fees.manage', module: 'fees', action: PERMISSION_ACTIONS.MANAGE } }],
        },
      },
    ]);
    client.permission.findMany.mockResolvedValue([
      { key: 'fees.view', module: 'fees', action: 'VIEW' },
      { key: 'fees.update', module: 'fees', action: 'UPDATE' },
    ]);

    const result = await service.getEffectivePermissionsWithScope(TENANT, USER);
    const scopedGrant = { scopeType: 'DEPARTMENT', campusId: undefined, departmentId: 'd1', programId: undefined };
    expect(result['fees.manage']).toEqual([scopedGrant]);
    expect(result['fees.view']).toEqual([scopedGrant]);
    expect(result['fees.update']).toEqual([scopedGrant]);
    expect(client.permission.findMany).toHaveBeenCalledWith({
      where: { module: { in: ['fees'] }, action: { in: [...ACTIONS_IMPLIED_BY_MANAGE] } },
    });
  });

  it('returns the cached map without hitting the database', async () => {
    const { service, client, redis } = makeService();
    redis.get.mockResolvedValue(JSON.stringify({ 'students.view': [{ scopeType: 'GLOBAL' }] }));

    const result = await service.getEffectivePermissionsWithScope(TENANT, USER);
    expect(result).toEqual({ 'students.view': [{ scopeType: 'GLOBAL' }] });
    expect(client.userRole.findMany).not.toHaveBeenCalled();
  });
});

describe('PermissionsService helpers', () => {
  it('getEffectivePermissions exposes just the keys', async () => {
    const { service, client } = makeService();
    client.userRole.findMany.mockResolvedValue([
      {
        scopeCampusId: null,
        scopeDepartmentId: null,
        scopeProgramId: null,
        role: { rolePermissions: [{ scopeType: 'GLOBAL', permission: { key: 'students.view', module: 'students', action: 'VIEW' } }] },
      },
    ]);
    await expect(service.getEffectivePermissions(TENANT, USER)).resolves.toEqual(['students.view']);
  });

  it('getScopeGrantsFor returns [] when the permission is not held', async () => {
    const { service } = makeService();
    await expect(service.getScopeGrantsFor(TENANT, USER, 'fees.refund')).resolves.toEqual([]);
  });

  it('invalidate drops the tenant/user cache entry', async () => {
    const { service, redis } = makeService();
    await service.invalidate(TENANT, USER);
    expect(redis.del).toHaveBeenCalledWith(`perms:${TENANT}:${USER}`);
  });
});
