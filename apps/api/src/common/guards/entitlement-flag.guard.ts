import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EntitlementKey } from '@college-erp/auth';
import { ENTITLEMENT_MODULE_MAP } from '@college-erp/auth';
import { EntitlementsGatewayService } from '../../modules/rbac/entitlements-gateway.service';
import { ENTITLEMENT_KEY } from '../decorators/require-entitlement.decorator';
import { TenantContextService } from '../prisma/tenant-context.service';

/** No-ops when the route has no @RequireEntitlement() metadata. Must run after
 * JwtAuthGuard + TenantMatchGuard. Resolves through the single EntitlementsGatewayService so a
 * granular capability (attendance.qr, fees.online_payment, …) is enforced server-side on the
 * API — never just hidden in the UI. */
@Injectable()
export class EntitlementFlagsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly gateway: EntitlementsGatewayService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<EntitlementKey | undefined>(ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }

    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('Tenant context could not be established.');
    }

    const allowed = await this.gateway.canUse(tenantId, required);
    if (!allowed) {
      const moduleKey = ENTITLEMENT_MODULE_MAP[required];
      throw new ForbiddenException(
        `This tenant's plan does not include the "${required}" entitlement (module: "${moduleKey}").`,
      );
    }
    return true;
  }
}