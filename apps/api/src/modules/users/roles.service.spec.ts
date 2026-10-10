import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';

function makeService(opts: { actorPermissions: string[]; isSystem?: boolean }) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const tenantPrisma = {
    client: {
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'r1', code: 'CUSTOM', isSystem: opts.isSystem ?? false }) },
      rolePermission: { deleteMany, createMany },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const platformPrisma = {
    client: {
      permission: {
        findMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in.map((key) => ({ id: `p-${key}`, key })),
        ),
      },
    },
  };
  const permissionsService = {
    getEffectivePermissions: jest.fn().mockResolvedValue(opts.actorPermissions),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RolesService(
    tenantPrisma as never,
    platformPrisma as never,
    permissionsService as never,
    { record: jest.fn() } as never,
  );
  return { service, deleteMany, createMany };
}

describe('RolesService.setPermissions privilege-escalation guard', () => {
  it('rejects granting a permission the actor does not hold', async () => {
    const { service, deleteMany, createMany } = makeService({ actorPermissions: ['roles.view'] });
    await expect(
      service.setPermissions('t1', 'r1', { permissionKeys: ['users.manage'] } as never, 'actor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rejects modifying a protected system role', async () => {
    const { service } = makeService({ actorPermissions: ['users.manage'], isSystem: true });
    await expect(
      service.setPermissions('t1', 'r1', { permissionKeys: ['users.manage'] } as never, 'actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies a grant list that is a subset of the actor\'s permissions', async () => {
    const { service, createMany } = makeService({ actorPermissions: ['users.manage', 'users.view'] });
    await service.setPermissions('t1', 'r1', { permissionKeys: ['users.view'] } as never, 'actor');
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});
