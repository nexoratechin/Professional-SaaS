import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { AppConfigService } from '../../config/app-config.service';
import { NotificationsService } from './notifications.service';
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/notifications.dto';

/**
 * Native Web Push self-service for the PWA — deliberately lighter than NotificationsController:
 * it requires only authentication + tenant match (+ the notifications feature), NOT
 * `notifications.view`, because every portal role (student, parent, faculty, staff) manages
 * its OWN browser subscription here. The recipient is always the current user; there is no
 * user id in any path or body, so one user can never subscribe or unsubscribe another.
 */
@ApiTags('push')
@Controller('push')
@UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
export class PushController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Public VAPID key + whether server-side Web Push is available.' })
  getConfig() {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY') ?? null;
    const privateKey = this.config.get('VAPID_PRIVATE_KEY') ?? null;
    return {
      enabled: Boolean(publicKey && privateKey),
      vapidPublicKey: publicKey,
    };
  }

  @Post('subscribe')
  @ApiOperation({ summary: "Register the current user's browser PushSubscription." })
  async subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushSubscribeDto) {
    const endpoint = dto.subscription.endpoint;
    const keys = dto.subscription.keys as { p256dh?: unknown; auth?: unknown } | undefined;
    if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
      throw new BadRequestException('subscription.endpoint is required.');
    }
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      throw new BadRequestException('subscription.keys.p256dh and subscription.keys.auth are required.');
    }

    const serialized = JSON.stringify({
      endpoint,
      expirationTime: (dto.subscription.expirationTime as number | null | undefined) ?? null,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    if (serialized.length > 2048) {
      throw new BadRequestException('Push subscription is too large to persist.');
    }

    await this.notificationsService.registerPushDevice(
      this.tenantContext.tenantId as string,
      user.id,
      serialized,
      'web',
    );
    return { success: true };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: "Remove the current user's subscription by push-service endpoint." })
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushUnsubscribeDto) {
    return this.notificationsService.unregisterPushDeviceByEndpoint(user.id, dto.endpoint);
  }
}
