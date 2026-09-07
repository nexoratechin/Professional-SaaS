import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLE_KEY, type PlatformUserRole } from '../decorators/require-platform-role.decorator';
import type { RequestWithTenant } from '../types/tenant-request';

/** No-ops when the route has no @RequirePlatformRole() metadata. Must run after
 * PlatformAuthGuard. Platform roles are a small fixed enum, not full RBAC — appropriate for an
 * internal ops team and deliberately separate from tenant permissions. */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformUserRole | undefined>(PLATFORM_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    if (request.user?.role !== required) {
      throw new ForbiddenException(`Requires platform role: ${required}`);
    }
    return true;
  }
}
