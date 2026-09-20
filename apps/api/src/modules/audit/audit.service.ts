import { Injectable } from '@nestjs/common';
import type { AuditScope, Prisma, PlatformAuditLog } from '@college-erp/database';
import { getCurrentRequestId } from '../../common/context/request-context';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

export interface RecordAuditEntryInput {
  scope: AuditScope;
  tenantId?: string | null;
  actorType: 'USER' | 'PLATFORM_USER' | 'SYSTEM';
  actorUserId?: string;
  actorPlatformUserId?: string;
  action: string;
  /** Which subsystem produced this entry — see packages/auth's AUDIT_MODULES. */
  module: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  /** Defaults to the current request's correlation id (see RequestIdMiddleware) when omitted —
   * pass explicitly only for entries written outside an HTTP request (none today). */
  requestId?: string;
}

export interface AuditLogSearchFilters {
  tenantId?: string;
  scope?: AuditScope;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Case-insensitive substring match against the actor's snapshotted email. */
  actorEmail?: string;
  requestId?: string;
  /** ISO 8601 strings, as they arrive from query params — converted to Date in search(). */
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  take?: number;
}

export interface AuditLogSearchResult {
  data: PlatformAuditLog[];
  total: number;
}

/**
 * Single append-only, centralized audit trail for both platform- and tenant-level sensitive
 * actions (see PlatformAuditLog's doc comment in packages/database/prisma/schema.prisma for the
 * immutability guarantee and denormalized-actorEmail rationale). Always writes through the
 * unscoped PlatformPrismaService — PlatformAuditLog is a control-plane model with an optional
 * tenantId, not a tenant-owned one, and it must remain writable for PLATFORM-scope events that
 * have no tenant at all. Deliberately exposes no update/delete method — the DB trigger is
 * defense in depth, not the only guarantee.
 */
@Injectable()
export class AuditService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async record(entry: RecordAuditEntryInput): Promise<void> {
    const actorEmail = await this.resolveActorEmail(entry);

    await this.platformPrisma.client.platformAuditLog.create({
      data: {
        scope: entry.scope,
        tenantId: entry.tenantId ?? null,
        actorType: entry.actorType,
        actorUserId: entry.actorUserId,
        actorPlatformUserId: entry.actorPlatformUserId,
        actorEmail,
        action: entry.action,
        module: entry.module,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestId: entry.requestId ?? getCurrentRequestId(),
      },
    });
  }

  /** Snapshots the actor's email AT WRITE TIME so the trail stays human-readable even after the
   * user is later renamed/deactivated — see the model's doc comment. One extra indexed PK
   * lookup per write; callers never need to plumb this through themselves. */
  private async resolveActorEmail(entry: RecordAuditEntryInput): Promise<string | undefined> {
    if (entry.actorUserId) {
      const user = await this.platformPrisma.client.user.findUnique({
        where: { id: entry.actorUserId },
        select: { email: true },
      });
      return user?.email;
    }
    if (entry.actorPlatformUserId) {
      const platformUser = await this.platformPrisma.client.platformUser.findUnique({
        where: { id: entry.actorPlatformUserId },
        select: { email: true },
      });
      return platformUser?.email;
    }
    return undefined;
  }

  async search(filters: AuditLogSearchFilters): Promise<AuditLogSearchResult> {
    const where: Prisma.PlatformAuditLogWhereInput = {
      tenantId: filters.tenantId,
      scope: filters.scope,
      module: filters.module,
      action: filters.action,
      entityType: filters.entityType,
      entityId: filters.entityId,
      requestId: filters.requestId,
      actorEmail: filters.actorEmail ? { contains: filters.actorEmail, mode: 'insensitive' } : undefined,
      createdAt:
        filters.dateFrom || filters.dateTo
          ? {
              gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
              lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
            }
          : undefined,
    };

    const [data, total] = await Promise.all([
      this.platformPrisma.client.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      this.platformPrisma.client.platformAuditLog.count({ where }),
    ]);

    return { data, total };
  }

  async findForTenant(
    tenantId: string,
    params: Omit<AuditLogSearchFilters, 'tenantId' | 'scope'> = {},
  ): Promise<AuditLogSearchResult> {
    return this.search({ ...params, tenantId });
  }

  async findAllPlatform(params: Omit<AuditLogSearchFilters, 'scope'> = {}): Promise<AuditLogSearchResult> {
    return this.search(params);
  }
}
