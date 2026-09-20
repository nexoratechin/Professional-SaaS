import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_SCOPE_TYPES } from '@college-erp/auth';
import type { PermissionScopeType as RolePermissionScopeType } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
  ) {}

  async list() {
    return this.tenantPrisma.client.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateRoleDto, actorUserId: string) {
    const role = await this.tenantPrisma.client.role.create({
      data: { tenantId, code: dto.code, name: dto.name, createdBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      module: AUDIT_MODULES.RBAC,
      entityType: 'Role',
      entityId: role.id,
      after: { code: role.code, name: role.name },
    });

    return role;
  }

  async setPermissions(tenantId: string, roleId: string, dto: SetRolePermissionsDto, actorUserId: string) {
    const role = await this.tenantPrisma.client.role.findFirst({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found.');
    }
    if (role.isSystem) {
      throw new BadRequestException('Cannot modify a protected system role.');
    }

    // Normalize both accepted shapes into one grant list — legacy flat keys default to GLOBAL.
    const grants = dto.grants?.length
      ? dto.grants
      : (dto.permissionKeys ?? []).map((key) => ({ key, scopeType: PERMISSION_SCOPE_TYPES.GLOBAL as string }));
    if (grants.length === 0) {
      throw new BadRequestException('Provide at least one permission grant.');
    }

    const permissions = await this.platformPrisma.client.permission.findMany({
      where: { key: { in: grants.map((grant) => grant.key) } },
    });
    if (permissions.length !== new Set(grants.map((grant) => grant.key)).size) {
      throw new BadRequestException('One or more permission keys are invalid.');
    }
    const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

    await this.tenantPrisma.client.rolePermission.deleteMany({ where: { roleId } });
    await this.tenantPrisma.client.rolePermission.createMany({
      data: grants.map((grant) => ({
        tenantId,
        roleId,
        permissionId: permissionIdByKey.get(grant.key) as string,
        scopeType: (grant.scopeType ?? PERMISSION_SCOPE_TYPES.GLOBAL) as RolePermissionScopeType,
        createdBy: actorUserId,
      })),
    });

    const affectedUserRoles = await this.tenantPrisma.client.userRole.findMany({ where: { roleId } });
    await Promise.all(affectedUserRoles.map((ur) => this.permissionsService.invalidate(tenantId, ur.userId)));

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
      module: AUDIT_MODULES.RBAC,
      entityType: 'Role',
      entityId: roleId,
      after: { grants },
    });

    return this.tenantPrisma.client.role.findFirst({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
  }
}
