import { buildDeadLetterPayload } from './dead-letter';

describe('buildDeadLetterPayload', () => {
  it('preserves the original payload and normalizes the failure', () => {
    const payload = buildDeadLetterPayload({
      sourceQueue: 'emails',
      sourceJobId: 42,
      jobName: 'deliver',
      tenantId: 'tenant-1',
      attemptsMade: 5,
      maxAttempts: 5,
      failedReason: '  SMTP timeout  ',
      payload: { notificationId: 'n1' },
      failedAt: new Date('2026-01-02T03:04:05Z'),
    });

    expect(payload).toMatchObject({
      sourceQueue: 'emails',
      sourceJobId: '42',
      jobName: 'deliver',
      tenantId: 'tenant-1',
      attemptsMade: 5,
      maxAttempts: 5,
      failedReason: 'SMTP timeout',
      failedAt: '2026-01-02T03:04:05.000Z',
      payload: { notificationId: 'n1' },
    });
  });

  it('defaults an empty reason and null tenant', () => {
    const payload = buildDeadLetterPayload({
      sourceQueue: 'sms',
      sourceJobId: null,
      jobName: 'deliver',
      attemptsMade: 1,
      maxAttempts: 3,
      failedReason: '   ',
      payload: null,
    });
    expect(payload.failedReason).toBe('Unknown failure');
    expect(payload.tenantId).toBeNull();
    expect(payload.sourceJobId).toBeNull();
  });
});
