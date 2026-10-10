import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Reads the opaque onboarding session token from the `X-Onboarding-Token` header.
 *
 * The onboarding wizard is public (a prospective college has no user account or tenant yet), so it
 * cannot use JwtAuthGuard. Authorization is instead "possession of the session token minted by
 * POST /onboarding/account": every non-public onboarding method requires this token and loads the
 * session it maps to. Exactly one token is ever issued per session and only its SHA-256 hash is
 * stored (see OnboardingSession.tokenHash).
 */
export const OnboardingToken = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = request.header('X-Onboarding-Token');
  return header && header.trim().length > 0 ? header.trim() : undefined;
});
