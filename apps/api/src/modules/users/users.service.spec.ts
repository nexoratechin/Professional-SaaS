import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

function makeService(opts: {
  rolePermissions: string[];
  actorPermissions: string[];
  roleExists?: boolean;
}) {
  const userRoleUpsert = jest.fn().mockResolvedValue({ id: 'ur1' });
  const rolePermissionFindMany = jest.fn().mockResolvedValue(
    opts.rolePermissions.map((key) => ({ permission: { key } })),
  );
  const tenantPrisma = {
    client: {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
      role: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.roleExists === false ? null : { id: 'r1', code: 'CUSTOM', isSystem: false }),
      },
      rolePermission: { findMany: rolePermissionFindMany },
      userRole: { upsert: userRoleUpsert },
    },
  };
  const permissionsService = {
    getEffectivePermissions: jest.fn().mockResolvedValue(opts.actorPermissions),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    tenantPrisma as never,
    permissionsService as never,
    { record: jest.fn() } as never,
    { issueVerificationToken: jest.fn() } as never,
  );
  return { service, userRoleUpsert, rolePermissionFindMany };
}

describe('UsersService.assignRole privilege-escalation guard', () => {
  it('rejects assigning a role that grants permissions the actor does not hold', async () => {
    // A user holding only roles.manage tries to grant themselves the seeded TENANT_ADMIN role.
    const { service, userRoleUpsert } = makeService({
      rolePermissions: ['roles.manage', 'users.manage', 'tenant.settings.manage'],
      actorPermissions: ['roles.manage'],
    });

    await expect(service.assignRole('t1', 'self', 'admin-role', {} as never, 'self')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRoleUpsert).not.toHaveBeenCalled();
  });

  it("allows assigning a role whose permissions are a subset of the actor's own", async () => {
    const { service, userRoleUpsert } = makeService({
      rolePermissions: ['users.view'],
      actorPermissions: ['users.manage', 'users.view', 'roles.manage'],
    });

    await service.assignRole('t1', 'target', 'r1', {} as never, 'actor');
    expect(userRoleUpsert).toHaveBeenCalledTimes(1);
  });

  it('still 404s when the user or role does not exist', async () => {
    const { service } = makeService({ rolePermissions: [], actorPermissions: [], roleExists: false });
    await expect(service.assignRole('t1', 'x', 'r1', {} as never, 'actor')).rejects.toBeInstanceOf(NotFoundException);
  });
});
