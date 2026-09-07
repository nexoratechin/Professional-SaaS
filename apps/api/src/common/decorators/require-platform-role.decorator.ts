import { SetMetadata } from '@nestjs/common';

export type PlatformUserRole = 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';

export const PLATFORM_ROLE_KEY = 'college_erp:required_platform_role';

/** Enforced by PlatformRoleGuard, which must run after PlatformAuthGuard. */
export const RequirePlatformRole = (role: PlatformUserRole) => SetMetadata(PLATFORM_ROLE_KEY, role);
