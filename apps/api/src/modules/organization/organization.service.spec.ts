import { ENTITY_META, type EntityName } from './organization.constants';
import { OrganizationService } from './organization.service';
import type { ScopeGrantLike } from './org-scope';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PermissionsService } from '../rbac/permissions.service';

function makeModel() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'r1', code: 'X', name: 'X' }),
    update: jest.fn().mockResolvedValue({ id: 'r1', code: 'X', name: 'X' }),
  };
}

function makeService(grants: ScopeGrantLike[]) {
  const client: Record<string, ReturnType<typeof makeModel>> = {};
  for (const name of Object.values(ENTITY_META)) {
    client[name.model as string] = makeModel();
  }
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const permissionsService = {
    getScopeGrantsFor: jest.fn().mockResolvedValue(grants),
  } as unknown as PermissionsService;
  return { service: new OrganizationService(tenantPrisma, auditService, permissionsService), client };
}

function modelFor(client: Record<string, ReturnType<typeof makeModel>>, entity: EntityName) {
  return client[ENTITY_META[entity].model]!;
}

const TENANT = 't1';
const USER = 'u1';

describe('OrganizationService list scoping', () => {
  it('returns nothing for tenant-global entities unless the user holds GLOBAL scope', async () => {
    const { service, client } = makeService([{ scopeType: 'CAMPUS', campusId: 'c1' }]);
    await service.list('academicYear', TENANT, USER, {});
    expect(modelFor(client, 'academicYear').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) }),
    );
  });

  it('returns full rows for academic years when the user holds GLOBAL scope', async () => {
    const { service, client } = makeService([{ scopeType: 'GLOBAL' }]);
    await service.list('academicYear', TENANT, USER, {});
    expect(modelFor(client, 'academicYear').findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: { in: [] } }) }),
    );
  });

  it('only applies parent filters the entity model actually owns', async () => {
    const { service, client } = makeService([{ scopeType: 'GLOBAL' }]);

    // campus has no parentRefs → a campusId/buildingId filter must be silently ignored,
    // otherwise Prisma would throw on an unknown where field.
    await service.list('campus', TENANT, USER, { campusId: 'x', buildingId: 'y', isActive: 'true' });
    const campusWhere = modelFor(client, 'campus').findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(campusWhere).not.toHaveProperty('campusId');
    expect(campusWhere).not.toHaveProperty('buildingId');
    expect(campusWhere.isActive).toBe(true);

    // department owns campusId → applied.
    await service.list('department', TENANT, USER, { campusId: 'd-campus' });
    const deptWhere = modelFor(client, 'department').findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(deptWhere.campusId).toBe('d-campus');
  });

  it('scope filters apply alongside search/filters', async () => {
    const { service, client } = makeService([{ scopeType: 'CAMPUS', campusId: 'c9' }]);
    await service.list('building', TENANT, USER, { q: 'gate', isActive: 'false' });
    const where = modelFor(client, 'building').findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where.campusId).toEqual({ in: ['c9'] });
    expect(where.isActive).toBe(false);
    expect(where.OR).toBeDefined();
  });
});