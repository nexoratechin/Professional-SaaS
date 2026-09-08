import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

interface DependencyHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Cross-tenant aggregation and infrastructure connectivity checks for the platform admin area —
 * genuinely computed from live data (Document.sizeBytes sums, real DB/Redis round-trips), never
 * mocked. Always reads through the unscoped PlatformPrismaService since these are, by
 * definition, platform-wide views spanning every tenant.
 */
@Injectable()
export class PlatformOpsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getSystemHealth() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: database.ok && redis.ok ? 'ok' : 'degraded',
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await this.platformPrisma.client.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Platform-wide: every tenant, not one. studentRoleHolders is a proxy metric (count of
   * STUDENT-role assignments) — no Student entity exists yet, see this task's summary. */
  async getDashboardSummary() {
    const [tenantsByStatus, totalActiveUsers, studentRoleHolders, storageAgg, subscriptionsByStatus, openSupportTickets] =
      await Promise.all([
        this.platformPrisma.client.tenant.groupBy({ by: ['status'], _count: true }),
        this.platformPrisma.client.user.count({ where: { status: 'ACTIVE' } }),
        this.platformPrisma.client.userRole.count({ where: { role: { code: 'STUDENT' } } }),
        this.platformPrisma.client.document.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } }),
        this.platformPrisma.client.subscription.groupBy({ by: ['status'], _count: true }),
        this.platformPrisma.client.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      ]);

    return {
      totalTenants: tenantsByStatus.reduce((sum, row) => sum + row._count, 0),
      tenantsByStatus: Object.fromEntries(tenantsByStatus.map((row) => [row.status, row._count])),
      totalActiveUsers,
      studentRoleHolders,
      totalStorageUsedBytes: storageAgg._sum.sizeBytes ?? 0,
      subscriptionsByStatus: Object.fromEntries(subscriptionsByStatus.map((row) => [row.status, row._count])),
      openSupportTickets,
    };
  }

  /** Top tenants by storage consumption — for the platform "storage usage" view. */
  async getStorageUsageByTenant(take = 20) {
    const rows = await this.platformPrisma.client.document.groupBy({
      by: ['tenantId'],
      where: { deletedAt: null },
      _sum: { sizeBytes: true },
      _count: true,
      orderBy: { _sum: { sizeBytes: 'desc' } },
      take,
    });

    const tenants = await this.platformPrisma.client.tenant.findMany({
      where: { id: { in: rows.map((row) => row.tenantId) } },
      select: { id: true, slug: true, name: true },
    });
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));

    return rows.map((row) => ({
      tenantId: row.tenantId,
      tenant: tenantById.get(row.tenantId) ?? null,
      documentCount: row._count,
      storageUsedBytes: row._sum.sizeBytes ?? 0,
    }));
  }
}
