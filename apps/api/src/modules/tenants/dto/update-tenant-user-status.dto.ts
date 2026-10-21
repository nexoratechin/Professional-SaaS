import { IsIn } from 'class-validator';

export const TENANT_USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

/** Platform-admin status change for a tenant user (activate / suspend / deactivate). */
export class UpdateTenantUserStatusDto {
  @IsIn(TENANT_USER_STATUSES)
  status!: (typeof TENANT_USER_STATUSES)[number];
}
