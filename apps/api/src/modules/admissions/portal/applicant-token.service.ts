import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Claim shape carried by the applicant bearer token. Deliberately separate from tenant-user
 * tokens: an applicant has no User row, no roles and no permissions — only an access-row id. */
export interface ApplicantTokenClaims {
  sub: string;
  tenantId: string;
  applicationId?: string;
  scope: 'admission:applicant';
  iat?: number;
  exp?: number;
}

export const APPLICANT_TOKEN_SCOPE = 'admission:applicant' as const;

/**
 * Signs and verifies public-portal applicant tokens with the same RS256 key pair the platform
 * already uses for tenant users, but under a distinct `scope` claim. `JwtAuthGuard` rejects these
 * (it expects a user id that resolves to a User row), and `ApplicantAccessGuard` rejects user
 * tokens for the same reason in reverse — the two realms cannot be swapped.
 */
@Injectable()
export class AdmissionApplicantTokenService {
  constructor(private readonly jwt: JwtService) {}

  async sign(input: { accessId: string; tenantId: string; applicationId?: string | null }, ttlSeconds: number): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: input.accessId,
        tenantId: input.tenantId,
        ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        scope: APPLICANT_TOKEN_SCOPE,
      },
      { expiresIn: ttlSeconds },
    );
  }

  async verify(token: string): Promise<ApplicantTokenClaims> {
    let claims: ApplicantTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<ApplicantTokenClaims>(token);
    } catch {
      throw new UnauthorizedException('This session has expired. Request a new code to continue.');
    }
    if (claims.scope !== APPLICANT_TOKEN_SCOPE || !claims.sub || !claims.tenantId) {
      throw new UnauthorizedException('Invalid applicant session.');
    }
    return claims;
  }
}
