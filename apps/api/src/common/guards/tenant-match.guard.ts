import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../../modules/audit/audit.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import type { RequestWithTenant } from '../types/tenant-request';

/**
 * Asserts the authenticated user's JWT tenantId matches the tenant resolved from the
 * subdomain/header for this request. This is the concrete mechanism behind "cross-tenant
 * access attempt is rejected and audited" — a mismatch is not just a 403, it's a recorded
 * security event. Must run after JwtAuthGuard (needs req.user) on every protected tenant route.
 */
@Injectable()
export class TenantMatchGuard implements CanActivate {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const resolvedTenant = request.resolvedTenant;
    const user = request.user;

    if (!resolvedTenant || !user?.tenantId) {
      throw new ForbiddenException('Tenant context could not be established.');
    }

    if (user.tenantId !== resolvedTenant.id) {
      await this.auditService.record({
        scope: 'PLATFORM',
        tenantId: resolvedTenant.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'CROSS_TENANT_ACCESS_ATTEMPT',
        entityType: 'Tenant',
        entityId: resolvedTenant.id,
        after: { attemptedWithTenantId: user.tenantId, resolvedTenantId: resolvedTenant.id },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new ForbiddenException('You do not have access to this tenant.');
    }

    this.tenantContext.setTenant(resolvedTenant.id, resolvedTenant.slug);
    return true;
  }
}
