import { Injectable } from '@nestjs/common';
import type { AuditScope, Prisma } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

export interface RecordAuditEntryInput {
  scope: AuditScope;
  tenantId?: string | null;
  actorType: 'USER' | 'PLATFORM_USER' | 'SYSTEM';
  actorUserId?: string;
  actorPlatformUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Single append-only audit trail for both platform- and tenant-level sensitive actions
 * (see PlatformAuditLog in packages/database/prisma/schema.prisma). Always writes through the
 * unscoped PlatformPrismaService — PlatformAuditLog is a control-plane model with an optional
 * tenantId, not a tenant-owned one, and it must remain writable for PLATFORM-scope events that
 * have no tenant at all.
 */
@Injectable()
export class AuditService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async record(entry: RecordAuditEntryInput): Promise<void> {
    await this.platformPrisma.client.platformAuditLog.create({
      data: {
        scope: entry.scope,
        tenantId: entry.tenantId ?? null,
        actorType: entry.actorType,
        actorUserId: entry.actorUserId,
        actorPlatformUserId: entry.actorPlatformUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  async findForTenant(tenantId: string, params: { skip?: number; take?: number } = {}) {
    return this.platformPrisma.client.platformAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }

  async findAllPlatform(params: { skip?: number; take?: number; tenantId?: string } = {}) {
    return this.platformPrisma.client.platformAuditLog.findMany({
      where: params.tenantId ? { tenantId: params.tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }
}
