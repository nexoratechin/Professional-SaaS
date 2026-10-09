import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PermissionsService, type ScopeGrant } from '../rbac/permissions.service';

/**
 * Campus-scope resolution for the multi-campus operations module.
 *
 * Every endpoint in the campus module is gated by exactly one permission key, and the scope
 * grants the caller holds for THAT key pin down which campuses they may see or mutate:
 *
 *   GLOBAL          -> every campus in the tenant
 *   CAMPUS          -> the campuses the holder is bound to (the concrete campusId comes from
 *                      the UserRole assignment's scopeCampusId at role-assignment time)
 *   DEPARTMENT/PROGRAM -> the campuses those departments/programs live under (scope widening,
 *                      mirroring org-scope.ts so a HOD sees the campus their department sits in)
 *   no grants at all -> nothing (endpoints fail closed)
 *
 * `resolveAccessibleCampusIds` returns `null` for GLOBAL (unrestricted) — callers treat null as
 * "no campus filter". An empty set means "no campuses" and must render empty, never everything.
 */
@Injectable()
export class CampusAccessService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /** Resolve the campus ids the caller may address under `permissionKey`, or null for GLOBAL. */
  async resolveAccessibleCampusIds(
    tenantId: string,
    userId: string,
    permissionKey: string,
  ): Promise<Set<string> | null> {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, permissionKey);
    return this.campusIdsFromGrants(grants);
  }

  /** Pure grant-to-id resolution (exported for unit tests). null = unrestricted (GLOBAL). */
  async campusIdsFromGrants(grants: ScopeGrant[]): Promise<Set<string> | null> {
    if (grants.some((grant) => grant.scopeType === 'GLOBAL')) {
      return null;
    }

    const campusIds = new Set<string>();
    const departmentIds = new Set<string>();
    const programIds = new Set<string>();

    for (const grant of grants) {
      if (grant.scopeType === 'CAMPUS' && grant.campusId) {
        campusIds.add(grant.campusId);
      } else if (grant.scopeType === 'DEPARTMENT' && grant.departmentId) {
        departmentIds.add(grant.departmentId);
      } else if (grant.scopeType === 'PROGRAM' && grant.programId) {
        programIds.add(grant.programId);
      }
    }

    if (departmentIds.size > 0) {
      const campuses = await this.tenantPrisma.client.department.findMany({
        where: { id: { in: [...departmentIds] } },
        select: { campusId: true },
      });
      for (const department of campuses) {
        if (department.campusId) campusIds.add(department.campusId);
      }
    }

    if (programIds.size > 0) {
      const programs = await this.tenantPrisma.client.program.findMany({
        where: { id: { in: [...programIds] } },
        select: { department: { select: { campusId: true } } },
      });
      for (const program of programs) {
        if (program.department?.campusId) campusIds.add(program.department.campusId);
      }
    }

    return campusIds;
  }

  /** Reject the call unless the caller's grants for `permissionKey` cover `campusId`. */
  async assertCampusAccessible(
    tenantId: string,
    userId: string,
    permissionKey: string,
    campusId: string,
  ): Promise<void> {
    const accessible = await this.resolveAccessibleCampusIds(tenantId, userId, permissionKey);
    if (accessible === null) {
      return; // GLOBAL
    }
    if (!accessible.has(campusId)) {
      throw new ForbiddenException('This campus is outside your access scope.');
    }
  }

  /**
   * Reject the call unless the caller holds `permissionKey` at GLOBAL scope. Used by the global
   * policies endpoints: institution-wide policy must never be reachable from a campus-scoped
   * grant — a campus admin can configure THEIR campus, never the whole institution's rules.
   */
  async assertGlobalGrant(tenantId: string, userId: string, permissionKey: string): Promise<void> {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, permissionKey);
    if (!grants.some((grant) => grant.scopeType === 'GLOBAL')) {
      throw new ForbiddenException('This operation requires institution-wide (GLOBAL) scope.');
    }
  }
}