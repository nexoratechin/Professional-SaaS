import type { CurrentUserDto } from '@college-erp/types';

interface UserWithRoles {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  status: string;
  userRoles: { role: { code: string } }[];
}

/** Shared by AuthController (direct login) and MfaController (post-challenge login) — both
 * produce the identical LoginResponseDto shape, so the mapping lives in exactly one place. */
export function toCurrentUserDto(user: UserWithRoles): CurrentUserDto {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    fullName: user.fullName,
    status: user.status as CurrentUserDto['status'],
    roles: user.userRoles.map((userRole) => userRole.role.code),
  };
}

/** Informational only (client uses it for a soft pre-emptive refresh) — the JWT's own `exp`
 * claim, set from ACCESS_TOKEN_TTL at signing time, is the actual source of truth. */
export function accessTokenExpiry(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}
