/** Claims carried by a tenant-user access token (RS256, 15 min TTL). */
export interface JwtAccessTokenClaims {
  /** User id (subject) */
  sub: string;
  /** Tenant the user belongs to — asserted against resolved tenant context on every request. */
  tenantId: string;
  /** Session id — lets a single session be revoked without invalidating every device. */
  sid: string;
  iat?: number;
  exp?: number;
}

/** Claims carried by a platform-admin access token — a separate universe from tenant RBAC. */
export interface PlatformJwtAccessTokenClaims {
  sub: string;
  sid: string;
  role: 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  sessionId: string;
  email: string;
  fullName: string;
}

export interface AuthenticatedPlatformUser {
  id: string;
  sessionId: string;
  email: string;
  fullName: string;
  role: 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';
}
