import { Injectable } from '@nestjs/common';
import type { AuditScope, Prisma, SecurityEventSeverity, SecurityEventType } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

export interface RecordSecurityEventInput {
  scope: AuditScope;
  tenantId?: string | null;
  userId?: string;
  platformUserId?: string;
  eventType: SecurityEventType;
  severity?: SecurityEventSeverity;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
}

/**
 * A typed, structured security timeline distinct from AuditService's generic CRUD/action trail
 * (see SecurityEvent's schema doc comment for why they're separate models). Always writes
 * through PlatformPrismaService with an explicit tenantId — SecurityEvent has an OPTIONAL
 * tenantId (it spans both the tenant-user and platform-admin realms), so it is NOT auto-scoped
 * by the tenant-guard extension, same convention as AuditService/LoginEvent.
 */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async record(entry: RecordSecurityEventInput): Promise<void> {
    await this.platformPrisma.client.securityEvent.create({
      data: {
        scope: entry.scope,
        tenantId: entry.tenantId ?? null,
        userId: entry.userId,
        platformUserId: entry.platformUserId,
        eventType: entry.eventType,
        severity: entry.severity ?? 'INFO',
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async findForTenant(tenantId: string, params: { skip?: number; take?: number } = {}) {
    return this.platformPrisma.client.securityEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }

  async findForUser(tenantId: string, userId: string, params: { skip?: number; take?: number } = {}) {
    return this.platformPrisma.client.securityEvent.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }
}
