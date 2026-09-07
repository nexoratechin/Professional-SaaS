import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_SEND)
  send(@Body() dto: SendNotificationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.send(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  list() {
    return this.notificationsService.list();
  }
}
