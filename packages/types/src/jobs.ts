export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Every background job payload MUST extend this. An HTTP request gets its tenant context from
 * TenantResolutionMiddleware + TenantMatchGuard — there is no request and no guard inside a
 * queue consumer, so the job payload itself is the only carrier of tenant context. The worker
 * refuses to process a job without a tenantId and uses only this value (never anything else in
 * the payload) to build the tenant-scoped Prisma client the job runs under.
 */
export interface TenantJobData {
  tenantId: string;
}

export interface NotificationJobData extends TenantJobData {
  notificationId: string;
}
