import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';

export interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    // LoginEvent has an OPTIONAL tenantId (control-plane-adjacent, see schema comment), so it is
    // NOT auto-scoped by the tenant-guard extension — reads must filter by tenantId explicitly,
    // same as AuditService does for PlatformAuditLog.
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listForUser(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.tenantPrisma.client.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
    }));
  }

  async revoke(tenantId: string, userId: string, sessionId: string, actorUserId: string): Promise<void> {
    // Tenant isolation (via the extension) already narrows this to the caller's own tenant; the
    // userId check on top of that stops one tenant user from revoking ANOTHER tenant user's
    // session — a same-tenant authorization boundary, distinct from cross-tenant isolation.
    const session = await this.tenantPrisma.client.session.findFirst({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found.');
    }

    await this.tenantPrisma.client.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'SESSION_REVOKED',
      entityType: 'Session',
      entityId: sessionId,
    });
  }

  async getLoginHistory(tenantId: string, email: string, take = 50) {
    return this.platformPrisma.client.loginEvent.findMany({
      where: { tenantId, emailAttempted: email },
      orderBy: { occurredAt: 'desc' },
      take,
    });
  }
}
