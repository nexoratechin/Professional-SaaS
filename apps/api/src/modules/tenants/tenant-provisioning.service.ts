import { Injectable } from '@nestjs/common';
import {
  createTenantScopedClient,
  provisionTenantDefaults,
  type ProvisionDefaultAdminInput,
  type ProvisioningClient,
} from '@college-erp/database';

/**
 * Runs once per tenant, right after creation: seeds the protected "College Admin"
 * (TENANT_ADMIN) system role with every currently-defined permission, the first active admin
 * user, and the other default system roles (Campus Admin, Principal, Registrar, HOD, Faculty,
 * Accountant, Exam Controller, Librarian, Hostel Warden, Transport Manager, HR, Placement
 * Officer, Student, Parent — see DEFAULT_ROLE_DEFINITIONS) ready for the admin to assign to real
 * people, plus the example DEFAULT_WORKFLOW_DEFINITIONS (fee refund + leave request approval
 * chains) proving the workflow engine end-to-end. This is what makes "tenant onboarding without
 * DB changes" true — a platform admin can provision a fully working, fully role-structured tenant
 * through the API alone.
 *
 * The routine itself lives in @college-erp/database (provisionTenantDefaults) so the demo seeder
 * reuses the exact same bootstrap — see packages/database/src/provisioning/tenant-provisioning.ts.
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
    // through it is what makes enterprise stores work: a dedicated store is seeded with its own
    // copy of the global catalog, so the permission ids referenced by the seeded roles are the
    // ones that exist in that store. The cast narrows the extended client to the structural
    // surface the shared provisioning routine needs — same delegates, extension-only differences.
    const tenantClient = createTenantScopedClient(input.tenantId);
    return provisionTenantDefaults(tenantClient as unknown as ProvisioningClient, input);
  }
}
