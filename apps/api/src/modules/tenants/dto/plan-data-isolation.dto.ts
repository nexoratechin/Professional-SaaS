import { IsIn, IsOptional } from 'class-validator';
import { TENANT_DATA_ISOLATION_MODES } from './set-tenant-data-isolation.dto';
import type { TenantDataIsolationModeDto } from './set-tenant-data-isolation.dto';

/** GET /tenants/:id/data-isolation/plan?targetMode=DEDICATED_SCHEMA */
export class PlanDataIsolationDto {
  @IsOptional()
  @IsIn(TENANT_DATA_ISOLATION_MODES)
  targetMode?: TenantDataIsolationModeDto;
}
