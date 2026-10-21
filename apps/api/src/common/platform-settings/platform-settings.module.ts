import { Global, Module } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * Global because the maintenance switch is read by AuthService (tenant login) as well as by the
 * platform-ops controller that changes it. Prisma and Audit are already global modules, so this
 * module only needs to expose its own service.
 */
@Global()
@Module({
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
