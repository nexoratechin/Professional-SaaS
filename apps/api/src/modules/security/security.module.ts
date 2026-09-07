import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { SecurityEventsController } from './security-events.controller';
import { SecurityEventsService } from './security-events.service';
import { SecuritySettingsController } from './security-settings.controller';
import { SecuritySettingsService } from './security-settings.service';

/** Deliberately has no dependency on AuthModule (which depends on THIS module for
 * SecuritySettingsService/SecurityEventsService during login/MFA/password flows) — keeping the
 * dependency one-directional avoids a circular module graph. */
@Module({
  imports: [CommonGuardsModule, RbacModule],
  controllers: [SecuritySettingsController, SecurityEventsController],
  providers: [SecuritySettingsService, SecurityEventsService],
  exports: [SecuritySettingsService, SecurityEventsService],
})
export class SecurityModule {}
