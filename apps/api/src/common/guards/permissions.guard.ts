import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@college-erp/auth';
import { PermissionsService } from '../../modules/rbac/permissions.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { TenantContextService } from '../prisma/tenant-context.service';
import type { RequestWithTenant } from '../types/tenant-request';

/** No-ops when the route has no @RequirePermission() metadata. Must run after
 * JwtAuthGuard + TenantMatchGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const tenantId = this.tenantContext.tenantId;
    const userId = request.user?.id;
    if (!tenantId || !userId) {
      throw new ForbiddenException('Tenant/user context could not be established.');
    }

    const permissions = await this.permissionsService.getEffectivePermissions(tenantId, userId);
    if (!permissions.includes(required)) {
      throw new ForbiddenException(`Missing required permission: ${required}`);
    }
    return true;
  }
}
