/**
 * Reusable tenant provisioning.
 *
 * Extracted from apps/api's TenantProvisioningService so the exact same bootstrap routine can be
 * shared by:
 *   - the API path (POST /tenants -> TenantProvisioningService), which runs once per tenant, and
 *   - the demo seeder (packages/database/src/seeding/demo), which must be able to re-run safely.
 *
 * The routine is idempotent by construction: every write is an upsert against a natural key
 * (role [tenantId, code], rolePermission [roleId, permissionId], user [tenantId, email],
 * userRole [tenantId, userId, roleId], workflow definition/state/transition [definitionId, code])
 * and approver rows are replaced wholesale per transition. Running it twice therefore converges
 * instead of colliding on the unique constraints.
 */
import * as bcrypt from 'bcryptjs';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLE_DEFINITIONS,
  DEFAULT_WORKFLOW_DEFINITIONS,
  PERMISSION_SCOPE_TYPES,
  SYSTEM_ROLE_CODES,
  type PermissionScopeType,
  type WorkflowDefinitionDefault,
} from '@college-erp/auth';

/**
 * Minimal structural surface shared by the unscoped PrismaClient (demo seeder) and the
 * tenant-scoped extended client (apps/api's createTenantScopedClient). Keeping it structural
 * lets both callers hand in their own client without casts leaking into either codebase.
 */
export type ProvisioningClient = Pick<
  PrismaClient,
  | 'permission'
  | 'role'
  | 'rolePermission'
  | 'user'
  | 'userRole'
  | 'workflowDefinition'
  | 'workflowState'
  | 'workflowTransition'
  | 'workflowTransitionApprover'
  | '$transaction'
>;

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
 * Seeds the protected "College Admin" (TENANT_ADMIN) system role with every currently-defined
 * permission, the first active admin user, and the other default system roles (Campus Admin,
 * Principal, Registrar, HOD, Faculty, Accountant, Exam Controller, Librarian, Hostel Warden,
 * Transport Manager, HR, Placement Officer, Student, Parent — see DEFAULT_ROLE_DEFINITIONS)
 * ready for the admin to assign to real people, plus the example DEFAULT_WORKFLOW_DEFINITIONS
 * (fee refund + leave request approval chains) proving the workflow engine end-to-end.
 *
 * "SaaS Super Admin" is deliberately not one of these — it's PlatformUserRole.PLATFORM_ADMIN in
 * the control plane, a different realm from tenant Roles (see packages/auth's doc comment).
 */
export async function provisionTenantDefaults(
  client: ProvisioningClient,
  input: ProvisionDefaultAdminInput,
): Promise<{
  adminUserId: string;
  rolesCreated: number;
  permissionsGranted: number;
}> {
  // Reading permissions through the caller's client (rather than a global singleton) is what
  // makes enterprise stores work: a dedicated store is seeded with its own copy of the global
  // catalog, so the permission ids referenced by the seeded roles are the ones that exist there.
  const allPermissions = await client.permission.findMany();
  const permissionIdByKey = new Map(allPermissions.map((permission) => [permission.key, permission.id]));

  const adminRole = await client.role.upsert({
    where: { tenantId_code: { tenantId: input.tenantId, code: SYSTEM_ROLE_CODES.TENANT_ADMIN } },
    update: {
      name: 'College Admin',
      isSystem: true,
      updatedBy: input.createdBy,
      deletedAt: null,
    },
    create: {
      tenantId: input.tenantId,
      code: SYSTEM_ROLE_CODES.TENANT_ADMIN,
      name: 'College Admin',
      isSystem: true,
      createdBy: input.createdBy,
    },
  });

  if (allPermissions.length > 0) {
    await client.rolePermission.createMany({
      data: allPermissions.map((permission) => ({
        tenantId: input.tenantId,
        roleId: adminRole.id,
        permissionId: permission.id,
        scopeType: PERMISSION_SCOPE_TYPES.GLOBAL,
      })),
      skipDuplicates: true,
    });
  }

  // Prefer a caller-supplied hash (onboarding captured it in step 1); otherwise hash the
  // plaintext. At least one of the two must be present.
  const passwordHash = input.passwordHash ?? (input.password ? await bcrypt.hash(input.password, 12) : undefined);
  if (!passwordHash) {
    throw new Error('provisionTenantDefaults requires either password or passwordHash.');
  }

  // Attach to an existing (onboarding-provisioned, INVITED) user when one is supplied, else
  // upsert the bootstrap admin by email — the two paths converge on the same active, verified
  // user, and the upsert keeps re-runs (demo seeder) safe.
  const adminUser = input.existingUserId
    ? await client.user.update({
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
    : await client.user.upsert({
        where: { tenantId_email: { tenantId: input.tenantId, email: input.email } },
        update: {
          fullName: input.fullName,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          updatedBy: input.createdBy,
        },
        create: {
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

  await client.userRole.upsert({
    where: {
      tenantId_userId_roleId: { tenantId: input.tenantId, userId: adminUser.id, roleId: adminRole.id },
    },
    update: {},
    create: { tenantId: input.tenantId, userId: adminUser.id, roleId: adminRole.id },
  });

  // The default roles below are seeded as ready-to-assign system roles — none are auto-assigned
  // to any user; that's the College Admin's call once real staff/students exist. (The demo
  // seeder assigns them explicitly to its sample people.)
  for (const roleDefinition of DEFAULT_ROLE_DEFINITIONS) {
    const role = await client.role.upsert({
      where: { tenantId_code: { tenantId: input.tenantId, code: roleDefinition.code } },
      update: { name: roleDefinition.name, isSystem: true, updatedBy: input.createdBy, deletedAt: null },
      create: {
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
      await client.rolePermission.createMany({
        data: grants.map((grant) => ({
          tenantId: input.tenantId,
          roleId: role.id,
          permissionId: grant.permissionId,
          scopeType: grant.scopeType,
        })),
        skipDuplicates: true,
      });
    }
  }

  for (const definition of DEFAULT_WORKFLOW_DEFINITIONS) {
    await seedWorkflowDefinition(client, input.tenantId, definition, input.createdBy);
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
 * Written directly against the passed client (no request-scoped Nest dependencies) so it can run
 * from POST /tenants, where no tenant context exists yet, and from the demo seeder alike.
 */
async function seedWorkflowDefinition(
  client: ProvisioningClient,
  tenantId: string,
  definition: WorkflowDefinitionDefault,
  createdBy?: string,
): Promise<void> {
  await client.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.workflowDefinition.upsert({
      where: { tenantId_code: { tenantId, code: definition.code } },
      update: {
        name: definition.name,
        description: definition.description,
        entityType: definition.entityType,
        isActive: true,
        updatedBy: createdBy,
        deletedAt: null,
      },
      create: {
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
      const row = await tx.workflowState.upsert({
        where: { definitionId_code: { definitionId: created.id, code: state.code } },
        update: {
          name: state.name,
          category: state.category ?? 'IN_PROGRESS',
          allowsResubmission: state.allowsResubmission ?? false,
          sequenceOrder: state.sequenceOrder ?? 0,
        },
        create: {
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
      const transitionRow = await tx.workflowTransition.upsert({
        where: { definitionId_code: { definitionId: created.id, code: transition.code } },
        update: {
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
        create: {
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

      // Approvers have no natural key beyond their transition; replace them wholesale so a
      // re-run with an updated catalog converges instead of duplicating approver rows.
      await tx.workflowTransitionApprover.deleteMany({ where: { transitionId: transitionRow.id } });
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
