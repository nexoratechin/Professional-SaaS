import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@college-erp/auth';
import { TenantFeaturesService } from '../../modules/rbac/tenant-features.service';
import { FEATURE_KEY } from '../decorators/require-feature.decorator';
import { TenantContextService } from '../prisma/tenant-context.service';

/** No-ops when the route has no @RequireFeature() metadata. Must run after
 * JwtAuthGuard + TenantMatchGuard. This is what lets subscription/plan changes gate module
 * access without a deploy. */
@Injectable()
export class FeatureFlagsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [
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

    const enabled = await this.tenantFeatures.isEnabled(tenantId, required);
    if (!enabled) {
      throw new ForbiddenException(`This tenant's plan does not include the "${required}" module.`);
    }
    return true;
  }
}
