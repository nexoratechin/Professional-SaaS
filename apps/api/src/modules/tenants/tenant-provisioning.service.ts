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

export interface ProvisionDefaultAdminInput {
  tenantId: string;
  email: string;
  fullName: string;
  /** Plaintext password for the bootstrap admin. Required unless `passwordHash` is supplied. */
  password?: string;
  /** A pre-computed bcrypt hash — used by the self-service onboarding flow, which captured the
   *  account's password (hashed) in step 1 and must never persist the plaintext across steps. */
  passwordHash?: string;
  /**
   * When set, the roles/permissions/workflows are attached to this EXISTING user (and the user is
   * activated) instead of creating a new one. The onboarding wizard provisions the account as an
   * INVITED user as soon as the tenant exists (step 2) so later steps can be audited against a
   * real actor, then finalizes it here at completion — without a duplicate-user conflict.
   */
  existingUserId?: string;
  /** The platform admin (or onboarding session) who created the tenant — stamped on seeded rows. */
  createdBy?: string;
}

/**
 * Runs once per tenant, right after creation: seeds the protected "College Admin"
 * (TENANT_ADMIN) system role with every currently-defined permission, the first active admin
 * user, and the other default system roles (Campus Admin, Principal, Registrar, HOD, Faculty, Accountant,
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
  async provisionDefaultAdmin(input: ProvisionDefaultAdminInput): Promise<{
    adminUserId: string;
    rolesCreated: number;
    permissionsGranted: number;
  }> {
    // The tenant client routes to the tenant's physical store (shared, dedicated schema or
    // dedicated database — see packages/database's connection registry). Reading permissions
    // through it (rather than the unscoped platform client) is what makes enterprise stores work:
    // a dedicated store is seeded with its own copy of the global catalog, so the permission ids
    // referenced by the seeded roles are the ones that exist in that store.
    const tenantClient = createTenantScopedClient(input.tenantId);
    const allPermissions = await tenantClient.permission.findMany();
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

    // Prefer a caller-supplied hash (onboarding captured it in step 1); otherwise hash the
    // plaintext. At least one of the two must be present.
    const passwordHash = input.passwordHash ?? (input.password ? await bcrypt.hash(input.password, 12) : undefined);
    if (!passwordHash) {
      throw new Error('provisionDefaultAdmin requires either password or passwordHash.');
    }

    // Attach to an existing (onboarding-provisioned, INVITED) user when one is supplied, else
    // create the bootstrap admin — the two paths converge on the same active, verified user.
    const adminUser = input.existingUserId
      ? await tenantClient.user.update({
          where: { id: input.existingUserId },
          data: {
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            updatedBy: input.createdBy,
          },
        })
      : await tenantClient.user.create({
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

    return {
      adminUserId: adminUser.id,
      // TENANT_ADMIN + every DEFAULT_ROLE_DEFINITIONS role.
      rolesCreated: 1 + DEFAULT_ROLE_DEFINITIONS.length,
      permissionsGranted: allPermissions.length,
    };
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
