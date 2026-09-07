import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@college-erp/auth';

export const PERMISSION_KEY = 'college_erp:required_permission';

/** Enforced by PermissionsGuard. Route must also be behind JwtAuthGuard + TenantMatchGuard. */
export const RequirePermission = (permission: PermissionKey) => SetMetadata(PERMISSION_KEY, permission);
