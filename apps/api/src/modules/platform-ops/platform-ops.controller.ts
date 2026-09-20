import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformOpsService } from './platform-ops.service';

/** Read-only cross-tenant views for the platform admin dashboard — open to any authenticated
 * platform user (PLATFORM_ADMIN or PLATFORM_SUPPORT); nothing here mutates anything. */
@ApiTags('platform-ops')
@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformOpsController {
  constructor(private readonly platformOps: PlatformOpsService) {}

  @Get('system/health')
  getHealth() {
    return this.platformOps.getSystemHealth();
  }

  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.platformOps.getDashboardSummary();
  }

  @Get('system/storage-usage')
  getStorageUsage() {
    return this.platformOps.getStorageUsageByTenant();
  }
}
