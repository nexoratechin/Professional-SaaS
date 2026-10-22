import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ApplicantTokenClaims } from './applicant-token.service';
import { APPLICANT_REQUEST_KEY, type RequestWithApplicant } from './applicant-access.guard';

/** Injects the verified applicant claims set by ApplicantAccessGuard. */
export const CurrentApplicant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApplicantTokenClaims => {
    const request = context.switchToHttp().getRequest<RequestWithApplicant>();
    const claims = request[APPLICANT_REQUEST_KEY];
    if (!claims) {
      throw new Error('CurrentApplicant used on a route without ApplicantAccessGuard.');
    }
    return claims;
  },
);
