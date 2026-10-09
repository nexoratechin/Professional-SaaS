import { Module } from '@nestjs/common';
import { EntitlementModule } from '../../entitlement/entitlement.module';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * Shared notification delivery pipeline, provided once and reused by the orchestrating
 * NotificationsProcessor and the dedicated emails/sms/whatsapp transport processors.
 */
@Module({
  imports: [EntitlementModule],
  providers: [NotificationDeliveryService],
  exports: [NotificationDeliveryService],
})
export class NotificationDeliveryModule {}
