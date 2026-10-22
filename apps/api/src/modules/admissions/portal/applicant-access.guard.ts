import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdmissionApplicantTokenService, type ApplicantTokenClaims } from './applicant-token.service';

export const APPLICANT_REQUEST_KEY = 'applicant';

export interface RequestWithApplicant extends Request {
  applicant?: ApplicantTokenClaims;
}

/**
 * Authenticates the public-portal applicant bearer token.
 *
 * Signature/scope/expiry are checked here. Binding to the resolved tenant and access row happens
 * in the service, because the tenant comes from the URL slug and the guard must not hit the DB on
 * every request. Public routes are excluded from TenantResolutionMiddleware, so this guard is the
 * only authentication that runs on them — never add it to a tenant-user controller.
 */
@Injectable()
export class ApplicantAccessGuard implements CanActivate {
  constructor(private readonly tokens: AdmissionApplicantTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApplicant>();
    const header = request.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (!token || (scheme ?? '').toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Verify your email or phone number to continue.');
    }

    request[APPLICANT_REQUEST_KEY] = await this.tokens.verify(token);
    return true;
  }
}
