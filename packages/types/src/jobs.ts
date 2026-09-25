export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  NOTIFICATIONS_CAMPAIGN: 'notifications-campaign',
  WORKFLOW_ESCALATION: 'workflow-escalation',
  SUBSCRIPTION_LIFECYCLE: 'subscription-lifecycle',
  TRANSPORT_GPS_SWEEP: 'transport-gps-sweep',
  HELPDESK_SLA: 'helpdesk-sla',
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

/**
 * Scheduled campaign launch: the API enqueues this with a BullMQ `delay` until the campaign's
 * scheduledAt; the NotificationsCampaignProcessor then resolves the audience (tenant-scoped) and
 * fans each recipient out onto the `notifications` queue through per-recipient Notification rows.
 */
export interface NotificationCampaignJobData extends TenantJobData {
  campaignId: string;
}

/**
 * Deliberately does NOT extend TenantJobData — this is a maintenance sweep across every tenant's
 * overdue workflow approval tasks, not a job scoped to one tenant. WorkflowEscalationProcessor
 * queries across tenants via the unscoped platform client to FIND overdue tasks, then performs
 * every actual mutation through a tenant-scoped client built per-tenant from what it found —
 * consistent with "tenant-aware background jobs" everywhere else in this codebase, just applied
 * at the read-then-fan-out level instead of the job-payload level.
 */
export type WorkflowEscalationSweepJobData = Record<string, never>;

/**
 * Same cross-tenant maintenance-sweep shape as WorkflowEscalationSweepJobData, for the same
 * reason: SubscriptionLifecycleProcessor finds every tenant's overdue invoices/expired
 * subscriptions via the unscoped platform client, then mutates each one through a tenant-scoped
 * client built per-tenant — never a job scoped to a single tenant up front.
 */
export type SubscriptionLifecycleSweepJobData = Record<string, never>;

/**
 * Same cross-tenant maintenance-sweep shape: the transport GPS sweep finds every tenant whose
 * TransportGpsConfig has polling enabled, then polls each tenant's fitted vehicles through its
 * provider adapter (packages/gps) and persists fixes + raises alerts through tenant-scoped
 * clients. Never a job scoped to a single tenant up front.
 */
export type TransportGpsSweepJobData = Record<string, never>;

/**
 * Same cross-tenant maintenance-sweep shape: HelpdeskSlaSweepProcessor finds every tenant's
 * tickets past their response/resolution SLA (via the unscoped platform client), then escalates
 * each one through a per-tenant client and queues notifications. Never a job scoped to a single
 * tenant up front.
 */
export type HelpdeskSlaSweepJobData = Record<string, never>;
