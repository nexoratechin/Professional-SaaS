import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ACTIONS_IMPLIED_BY_MANAGE, PERMISSION_ACTIONS, type PermissionKey, type PermissionScopeType } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

const CACHE_TTL_SECONDS = 300;

function cacheKey(tenantId: string, userId: string): string {
  return `perms:${tenantId}:${userId}`;
}

/** One "this role assignment grants this permission at this scope" fact. A user can accumulate
 * several grants of the SAME permission key (e.g. a GLOBAL grant from one role and a
 * DEPARTMENT-scoped grant from another) — callers should treat the array as OR'd: the action is
 * allowed if ANY grant's scope covers the target record. */
export interface ScopeGrant {
  scopeType: PermissionScopeType;
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

export type EffectivePermissionMap = Record<string, ScopeGrant[]>;

/**
 * Resolves a tenant user's effective, hierarchical permission set: UserRole -> Role ->
 * RolePermission -> Permission, expanded with two forms of inheritance:
 *  1. Action inheritance — a MANAGE grant on a module implies VIEW/CREATE/UPDATE/DELETE on that
 *     same module, resolved against whichever such permissions actually exist in the Permission
 *     catalog (DB-driven, so newly added permissions are picked up automatically — nothing to
 *     maintain here when a module adds a permission).
 *  2. Scope inheritance — an implied permission carries the SAME scope grant(s) as the MANAGE
 *     grant(s) that implied it.
 * Redis-cached for 5 minutes, invalidated explicitly by UsersService/RolesService on any
 * role/permission/assignment change.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getEffectivePermissionsWithScope(tenantId: string, userId: string): Promise<EffectivePermissionMap> {
    const cached = await this.redis.get(cacheKey(tenantId, userId));
    if (cached) {
      return JSON.parse(cached) as EffectivePermissionMap;
    }

    const userRoles = await this.tenantPrisma.client.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    const grantsByKey = new Map<string, ScopeGrant[]>();
    const manageScopesByModule = new Map<string, ScopeGrant[]>();

    for (const userRole of userRoles) {
      const assignmentScopeValue = {
        campusId: userRole.scopeCampusId ?? undefined,
        departmentId: userRole.scopeDepartmentId ?? undefined,
        programId: userRole.scopeProgramId ?? undefined,
      };

      for (const rolePermission of userRole.role.rolePermissions) {
        const { key, module, action } = rolePermission.permission;
        const grant: ScopeGrant = { scopeType: rolePermission.scopeType, ...assignmentScopeValue };

        grantsByKey.set(key, [...(grantsByKey.get(key) ?? []), grant]);

        if (action === PERMISSION_ACTIONS.MANAGE) {
          manageScopesByModule.set(module, [...(manageScopesByModule.get(module) ?? []), grant]);
        }
      }
    }

    if (manageScopesByModule.size > 0) {
      const impliedPermissions = await this.tenantPrisma.client.permission.findMany({
        where: {
          module: { in: Array.from(manageScopesByModule.keys()) },
          action: { in: [...ACTIONS_IMPLIED_BY_MANAGE] },
        },
      });

      for (const permission of impliedPermissions) {
        const impliedScopes = manageScopesByModule.get(permission.module) ?? [];
        grantsByKey.set(permission.key, [...(grantsByKey.get(permission.key) ?? []), ...impliedScopes]);
      }
    }

    const result: EffectivePermissionMap = Object.fromEntries(grantsByKey);
    await this.redis.set(cacheKey(tenantId, userId), JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    return result;
  }

  async getEffectivePermissions(tenantId: string, userId: string): Promise<PermissionKey[]> {
    const withScope = await this.getEffectivePermissionsWithScope(tenantId, userId);
    return Object.keys(withScope) as PermissionKey[];
  }

  /** Scope grants for one specific permission — the building block a future module's service
   * would call to decide how to filter its own queries (e.g. "only this department's students")
   * once that module exists. Empty array means the user does not hold this permission at all. */
  async getScopeGrantsFor(tenantId: string, userId: string, permissionKey: string): Promise<ScopeGrant[]> {
    const withScope = await this.getEffectivePermissionsWithScope(tenantId, userId);
    return withScope[permissionKey] ?? [];
  }

  async invalidate(tenantId: string, userId: string): Promise<void> {
    await this.redis.del(cacheKey(tenantId, userId));
  }
}
