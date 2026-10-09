import { IsIn } from 'class-validator';

export const TENANT_DATA_ISOLATION_MODES = ['SHARED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE'] as const;
export type TenantDataIsolationModeDto = (typeof TENANT_DATA_ISOLATION_MODES)[number];

/** PATCH /tenants/:id/data-isolation — explicit opt-in/out of a dedicated physical store. */
export class SetTenantDataIsolationDto {
  @IsIn(TENANT_DATA_ISOLATION_MODES)
  mode!: TenantDataIsolationModeDto;
}
