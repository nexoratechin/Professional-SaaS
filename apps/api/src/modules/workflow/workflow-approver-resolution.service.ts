import { Injectable } from '@nestjs/common';
import type { Prisma, WorkflowTransitionApprover } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';

export interface ResolvedApprover {
  userId: string;
  email: string;
}

export type ApproverSlot = Pick<WorkflowTransitionApprover, 'approverType' | 'roleCode' | 'specificUserId' | 'scopeField'>;

/** The only context keys a slot's scopeField may reference — matches the three concrete scope
 * columns UserRole already carries (see the hierarchical RBAC schema). Anything else is treated
 * as unscoped (GLOBAL-only holders eligible) rather than silently matching everyone. */
const SCOPE_FIELD_TO_COLUMN: Record<string, 'scopeCampusId' | 'scopeDepartmentId' | 'scopeProgramId'> = {
  campusId: 'scopeCampusId',
  departmentId: 'scopeDepartmentId',
  programId: 'scopeProgramId',
};

export const KNOWN_SCOPE_FIELDS = Object.keys(SCOPE_FIELD_TO_COLUMN);

/**
 * Resolves a WorkflowTransitionApprover slot to the concrete tenant user(s) allowed to act on it
 * right now. Deliberately reuses the SAME UserRole scope columns the hierarchical RBAC system
 * already maintains (see packages/database's UserRole model) rather than inventing a parallel
 * "who can approve what" concept — a slot configured as `{ approverType: ROLE, roleCode: 'HOD',
 * scopeField: 'departmentId' }` is satisfied by exactly the same users who'd be scoped HODs for
 * that department under RBAC.
 */
@Injectable()
export class WorkflowApproverResolutionService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async resolveEligibleUsers(slot: ApproverSlot, context: Record<string, unknown> | null): Promise<ResolvedApprover[]> {
    if (slot.approverType === 'SPECIFIC_USER') {
      if (!slot.specificUserId) {
        return [];
      }
      const user = await this.tenantPrisma.client.user.findFirst({
        where: { id: slot.specificUserId, status: 'ACTIVE' },
        select: { id: true, email: true },
      });
      return user ? [{ userId: user.id, email: user.email }] : [];
    }

    if (!slot.roleCode) {
      return [];
    }

    const where: Prisma.UserRoleWhereInput = {
      role: { code: slot.roleCode, deletedAt: null },
      user: { status: 'ACTIVE' },
    };

    const column = slot.scopeField ? SCOPE_FIELD_TO_COLUMN[slot.scopeField] : undefined;
    if (column) {
      const scopeValue = context?.[slot.scopeField as string];
      where.OR = [
        { [column]: null } as Prisma.UserRoleWhereInput,
        ...(typeof scopeValue === 'string' ? [{ [column]: scopeValue } as Prisma.UserRoleWhereInput] : []),
      ];
    }

    const userRoles = await this.tenantPrisma.client.userRole.findMany({
      where,
      include: { user: { select: { id: true, email: true } } },
    });

    const byUserId = new Map(userRoles.map((userRole) => [userRole.user.id, userRole.user.email]));
    return Array.from(byUserId, ([userId, email]) => ({ userId, email }));
  }

  async isUserEligible(slot: ApproverSlot, context: Record<string, unknown> | null, userId: string): Promise<boolean> {
    const eligible = await this.resolveEligibleUsers(slot, context);
    return eligible.some((approver) => approver.userId === userId);
  }
}
