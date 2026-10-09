import type { Job, Queue } from 'bullmq';
import type { NotificationJobData } from '@college-erp/types';
import { NotificationsProcessor } from './notifications.processor';
import type { NotificationDeliveryService } from './notification-delivery.service';

function buildProcessor(): NotificationsProcessor {
  return new NotificationsProcessor(
    {} as NotificationDeliveryService,
    {} as Queue,
    {} as Queue,
    {} as Queue,
  );
}

describe('NotificationsProcessor tenant-awareness guard', () => {
  it('refuses to process a job with no tenantId, before touching the database', async () => {
    const processor = buildProcessor();
    const job = { data: { tenantId: '', notificationId: 'some-id' } } as Job<NotificationJobData>;

    await expect(processor.process(job)).rejects.toThrow(/missing tenantId/i);
  });

  it('refuses a job whose data is entirely absent', async () => {
    const processor = buildProcessor();
    const job = { name: 'deliver', data: undefined } as unknown as Job<NotificationJobData>;

    await expect(processor.process(job)).rejects.toThrow(/missing tenantId/i);
  });
});
