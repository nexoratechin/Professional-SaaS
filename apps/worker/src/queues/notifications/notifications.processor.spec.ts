import type { Job } from 'bullmq';
import type { NotificationJobData } from '@college-erp/types';
import { NotificationsProcessor } from './notifications.processor';

describe('NotificationsProcessor tenant-awareness guard', () => {
  it('refuses to process a job with no tenantId, before touching the database', async () => {
    const processor = new NotificationsProcessor();
    const job = { data: { tenantId: '', notificationId: 'some-id' } } as Job<NotificationJobData>;

    await expect(processor.process(job)).rejects.toThrow(/missing tenantId/i);
  });
});
