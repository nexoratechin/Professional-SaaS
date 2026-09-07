/** Shared response-shape contracts between apps/api and apps/web. Plain data only — no
 * class-validator/NestJS decorators here, so this package stays usable from the frontend. */

export * from './jobs';

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  timezone: string;
}

export interface CurrentUserDto {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  roles: string[];
}

export interface PermissionsResponseDto {
  permissions: string[];
}

export interface FeatureFlagsResponseDto {
  features: Record<string, boolean>;
}

export interface LoginRequestDto {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface LoginResponseDto {
  mfaRequired?: false;
  accessToken: string;
  accessTokenExpiresAt: string;
  user: CurrentUserDto;
  /** Tenant enforces MFA but this user hasn't enrolled yet — a soft nag, not a hard block. */
  mfaSetupRequired?: boolean;
}

export interface MfaChallengeResponseDto {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

/** POST /auth/login's response shape — a normal LoginResponseDto, or a challenge the client
 * must resolve via POST /auth/mfa/verify before it has a real access token. */
export type LoginResultDto = LoginResponseDto | MfaChallengeResponseDto;
