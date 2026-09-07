import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import type { RequestWithTenant } from '../types/tenant-request';

/** Available on any route guarded by PlatformAuthGuard. */
export const CurrentPlatformUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedPlatformUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return request.user as AuthenticatedPlatformUser;
  },
);
