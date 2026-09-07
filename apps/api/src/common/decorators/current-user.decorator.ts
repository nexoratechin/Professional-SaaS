import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@college-erp/auth';
import type { RequestWithTenant } from '../types/tenant-request';

/** Available on any route guarded by JwtAuthGuard — the tenant user attached by JwtStrategy. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<RequestWithTenant>();
  return request.user as AuthenticatedUser;
});
