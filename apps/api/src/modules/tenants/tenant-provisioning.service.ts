import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createTenantScopedClient, type Prisma, type TenantScopedPrismaClient } from '@college-erp/database';
import {
  DEFAULT_ROLE_DEFINITIONS,
  DEFAULT_WORKFLOW_DEFINITIONS,
  PERMISSION_SCOPE_TYPES,
  SYSTEM_ROLE_CODES,
  type PermissionScopeType,
  type WorkflowDefinitionDefault,
} from '@college-erp/auth';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

export interface ProvisionDefaultAdminInput {
  tenantId: string;
  email: string;
  fullName: string;
  password: string;
  /** The platform admin who created the tenant — stamped onto the seeded role/user rows. */
  createdBy?: string;
}

/**
 * Runs once per tenant, right after creation: seeds the protected "College Admin"
 * (TENANT_ADMIN) system role with every currently-defined permission, the first active admin
 * user, and the other 13 default system roles (Principal, Registrar, HOD, Faculty, Accountant,
 * Exam Controller, Librarian, Hostel Warden, Transport Manager, HR, Placement Officer, Student,
 * Parent — see DEFAULT_ROLE_DEFINITIONS) ready for the admin to assign to real people, plus the
 * example DEFAULT_WORKFLOW_DEFINITIONS (fee refund + leave request approval chains) proving the
 * workflow engine end-to-end. This is what makes "tenant onboarding without DB changes" true — a
 * platform admin can provision a fully working, fully role-structured tenant through the API
 * alone.
 *
 * "SaaS Super Admin" is deliberately not one of these — it's PlatformUserRole.PLATFORM_ADMIN in
 * the control plane, a different realm from tenant Roles (see packages/auth's doc comment).
 */
@Injectable()
export class TenantProvisioningService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async provisionDefaultAdmin(input: ProvisionDefaultAdminInput): Promise<void> {
    const tenantClient = createTenantScopedClient(input.tenantId);
    const allPermissions = await this.platformPrisma.client.permission.findMany();
    const permissionIdByKey = new Map(allPermissions.map((permission) => [permission.key, permission.id]));

    const adminRole = await tenantClient.role.create({
      data: {
        tenantId: input.tenantId,
        code: SYSTEM_ROLE_CODES.TENANT_ADMIN,
        name: 'College Admin',
        isSystem: true,
        createdBy: input.createdBy,
      },
    });

    if (allPermissions.length > 0) {
      await tenantClient.rolePermission.createMany({
        data: allPermissions.map((permission) => ({
          tenantId: input.tenantId,
          roleId: adminRole.id,
          permissionId: permission.id,
          scopeType: PERMISSION_SCOPE_TYPES.GLOBAL,
        })),
      });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const adminUser = await tenantClient.user.create({
      data: {
        tenantId: input.tenantId,
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        status: 'ACTIVE',
        // The platform admin who provisioned this tenant typed this email themselves — treat
        // it as already verified rather than sending a verification link to the bootstrap admin.
        emailVerifiedAt: new Date(),
        createdBy: input.createdBy,
      },
    });

    await tenantClient.userRole.create({
      data: { tenantId: input.tenantId, userId: adminUser.id, roleId: adminRole.id },
    });

    // The 13 role definitions below are seeded as ready-to-assign system roles — none are
    // auto-assigned to any user; that's the College Admin's call once real staff/students exist.
    for (const roleDefinition of DEFAULT_ROLE_DEFINITIONS) {
      const role = await tenantClient.role.create({
        data: {
          tenantId: input.tenantId,
          code: roleDefinition.code,
          name: roleDefinition.name,
          isSystem: true,
          createdBy: input.createdBy,
        },
      });

      const grants = roleDefinition.grants
        .map((grant) => ({
          permissionId: permissionIdByKey.get(grant.key),
          scopeType: grant.scopeType ?? PERMISSION_SCOPE_TYPES.GLOBAL,
        }))
        .filter(
          (grant): grant is { permissionId: string; scopeType: PermissionScopeType } => Boolean(grant.permissionId),
        );

      if (grants.length > 0) {
        await tenantClient.rolePermission.createMany({
          data: grants.map((grant) => ({
            tenantId: input.tenantId,
            roleId: role.id,
            permissionId: grant.permissionId,
            scopeType: grant.scopeType,
          })),
        });
      }
    }

    for (const definition of DEFAULT_WORKFLOW_DEFINITIONS) {
      await this.seedWorkflowDefinition(tenantClient, input.tenantId, definition, input.createdBy);
    }
  }

  /**
   * Mirrors WorkflowDefinitionsService.createDefinition()'s write shape (definition -> states ->
   * transitions -> approvers) but skips its request-time validation — this data comes from
   * DEFAULT_WORKFLOW_DEFINITIONS, not tenant-admin input, so it's trusted by construction.
   * Written directly against `tenantClient` (built manually via createTenantScopedClient, same
   * as every other write in this method) rather than injecting WorkflowDefinitionsService: this
   * runs from POST /tenants, a PLATFORM-realm request with no resolved tenant context yet — the
   * request-scoped TenantScopedPrismaService that service depends on would throw before ever
   * reaching this tenant, which doesn't exist until this very call creates it.
   */
  private async seedWorkflowDefinition(
    tenantClient: TenantScopedPrismaClient,
    tenantId: string,
    definition: WorkflowDefinitionDefault,
    createdBy?: string,
  ): Promise<void> {
    await tenantClient.$transaction(async (tx) => {
      const created = await tx.workflowDefinition.create({
        data: {
          tenantId,
          code: definition.code,
          name: definition.name,
          description: definition.description,
          entityType: definition.entityType,
          isActive: true,
          createdBy,
        },
      });

      const stateIdByCode = new Map<string, string>();
      for (const state of definition.states) {
        const row = await tx.workflowState.create({
          data: {
            tenantId,
            definitionId: created.id,
            code: state.code,
            name: state.name,
            category: state.category ?? 'IN_PROGRESS',
            allowsResubmission: state.allowsResubmission ?? false,
            sequenceOrder: state.sequenceOrder ?? 0,
          },
        });
        stateIdByCode.set(state.code, row.id);
      }

      for (const transition of definition.transitions) {
        const transitionRow = await tx.workflowTransition.create({
          data: {
            tenantId,
            definitionId: created.id,
            code: transition.code,
            name: transition.name,
            fromStateId: stateIdByCode.get(transition.fromStateCode) as string,
            toStateId: stateIdByCode.get(transition.toStateCode) as string,
            action: transition.action,
            priority: transition.priority ?? 0,
            conditionExpression: (transition.conditionExpression ?? undefined) as Prisma.InputJsonValue,
            approvalMode: transition.approvalMode ?? 'NONE',
            parallelRule: transition.parallelRule,
            parallelQuorumCount: transition.parallelQuorumCount,
            deadlineHours: transition.deadlineHours,
            escalationRoleCode: transition.escalationRoleCode,
            escalationAfterHours: transition.escalationAfterHours,
          },
        });

        if (transition.approvers?.length) {
          await tx.workflowTransitionApprover.createMany({
            data: transition.approvers.map((approver) => ({
              tenantId,
              transitionId: transitionRow.id,
              approverType: approver.approverType,
              roleCode: approver.roleCode,
              scopeField: approver.scopeField,
              sequenceOrder: approver.sequenceOrder ?? 0,
            })),
          });
        }
      }
    });
  }
}
