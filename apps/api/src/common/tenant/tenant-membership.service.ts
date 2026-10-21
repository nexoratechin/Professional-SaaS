import { Injectable } from '@nestjs/common';
import type { TenantWorkspaceDto } from '@college-erp/types';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';

/**
 * Cross-tenant workspace directory.
 *
 * `User` rows are tenant-scoped (`users.tenant_id`), so "which colleges can this person enter?"
 * cannot be answered inside one tenant store. This service maintains the control-plane
 * `tenant_memberships` index keyed by normalized email, which is what the workspace picker reads.
 *
 * Rules:
 * - Writes are best-effort at account creation; a missed row self-heals on the user's next
 *   authenticated read, so an invite race can never lock someone out of their own workspace.
 * - Reads only return TRIAL/ACTIVE tenants. SUSPENDED/CANCELED tenants are resolved by the
 *   tenant middleware anyway (403) and must never be offered as a destination.
 * - This is a directory, not an authorization store: every tenant request is still re-authorized
 *   by JWT tenant id + TenantMatchGuard + RBAC inside the target tenant.
 */
@Injectable()
export class TenantMembershipService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async record(input: { tenantId: string; userId: string; email: string; isActive?: boolean }): Promise<void> {
    const email = TenantMembershipService.normalizeEmail(input.email);
    if (!email) return;
    await this.platformPrisma.client.tenantMembership.upsert({
      where: { email_tenantId: { email, tenantId: input.tenantId } },
      update: { userId: input.userId },
      create: {
        email,
        tenantId: input.tenantId,
        userId: input.userId,
        isActive: input.isActive ?? true,
      },
    });
  }

  /** Flip the directory entry when a user is suspended/reactivated inside a tenant. Never throws
   * into the caller: a status change must succeed even if the directory write races. */
  async setActive(tenantId: string, userId: string, isActive: boolean): Promise<void> {
    try {
      await this.platformPrisma.client.tenantMembership.updateMany({
        where: { tenantId, userId },
        data: { isActive },
      });
    } catch {
      // Directory is advisory; the tenant-local User.status remains authoritative for login.
    }
  }

  /**
   * List the signed-in user's workspaces. Also self-heals a missing row for the tenant they are
   * currently authenticated in (legacy users created before this table existed).
   */
  async listForUser(tenantId: string, userId: string, email: string): Promise<TenantWorkspaceDto[]> {
    const normalized = TenantMembershipService.normalizeEmail(email);
    if (!normalized) return [];

    await this.platformPrisma.client.tenantMembership
      .upsert({
        where: { email_tenantId: { email: normalized, tenantId } },
        // Existing rows are never reactivated here — a suspended membership stays suspended.
        update: {},
        create: { email: normalized, tenantId, userId },
      })
      .catch(() => undefined);

    const rows = await this.platformPrisma.client.tenantMembership.findMany({
      where: {
        email: normalized,
        isActive: true,
        tenant: { status: { in: ['TRIAL', 'ACTIVE'] } },
      },
      include: { tenant: { select: { slug: true, name: true, status: true } } },
    });

    return rows
      .map((row) => ({
        slug: row.tenant.slug,
        name: row.tenant.name,
        status: row.tenant.status,
        isCurrent: row.tenantId === tenantId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
