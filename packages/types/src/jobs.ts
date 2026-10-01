export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  NOTIFICATIONS_CAMPAIGN: 'notifications-campaign',
  WORKFLOW_ESCALATION: 'workflow-escalation',
  SUBSCRIPTION_LIFECYCLE: 'subscription-lifecycle',
  TRANSPORT_GPS_SWEEP: 'transport-gps-sweep',
  HELPDESK_SLA: 'helpdesk-sla',
  DOCUMENT_VIRUS_SCAN: 'document-virus-scan',
  DOCUMENT_RETENTION: 'document-retention',
  REPORT_EXPORTS: 'report-exports',
  ANALYTICS_REFRESH: 'analytics-refresh',
  /** AI document classification + OCR extraction (apps/worker's ai queues). */
  AI_DOCUMENT_PROCESSING: 'ai-document-processing',
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

/**
 * Per-virus-scan job: enqueued by the API when an upload is confirmed (DocumentVirusScanProcessor
 * in apps/worker). All work runs through the tenant-scoped client built from tenantId; the
 * processor marks the version CLEAN/INFECTED + the document READY/QUARANTINED, deleting the
 * storage object when infected.
 */
export interface DocumentVirusScanJobData extends TenantJobData {
  documentId: string;
  versionId: string;
}

/**
 * Same cross-tenant maintenance-sweep shape: DocumentRetentionSweepProcessor finds documents
 * whose expiresAt (or their DocumentType's retention window) has passed, then expires each one
 * and removes its storage objects through tenant-scoped clients.
 */
export type DocumentRetentionSweepJobData = Record<string, never>;

/**
 * One async report export. Enqueued by the API when an export is requested and by the worker's
 * due-schedule dispatcher. The processor loads the ReportRun through a tenant-scoped client built
 * from tenantId, renders the stored filters/template snapshot, uploads the file under the tenant's
 * prefix and advances the run lifecycle QUEUED/RUNNING -> COMPLETED/FAILED.
 */
export interface ReportExportJobData extends TenantJobData {
  runId: string;
}

/**
 * Analytics rollup refresh. Same cross-tenant maintenance-sweep shape as
 * SubscriptionLifecycleSweepJobData: AnalyticsRefreshProcessor walks every tenant with the
 * analytics refresh registered, recomputes each (scope, period) bucket through
 * @college-erp/analytics, and upserts it onto AnalyticsSnapshot. Never a job scoped to a single
 * tenant up front - one sweep covers the whole platform because the SaaS rollup is itself
 * cross-tenant.
 */
export type AnalyticsRefreshSweepJobData = Record<string, never>;

/**
 * One tenant's rollup recompute, enqueued by the sweep (or by an API "refresh now" request) when
 * only a single tenant is out of date. The processor builds its tenant-scoped client from
 * `tenantId` alone, exactly like every other tenant-scoped job.
 */
export interface AnalyticsRefreshTenantJobData extends TenantJobData {
  /** Bucket width to recompute. MONTHLY for the durable MRR baseline, DAILY for the trend charts. */
  granularity: 'DAILY' | 'MONTHLY';
  /** Number of trailing buckets to recompute, so a re-run repairs gaps a missed sweep left behind. */
  periods: number;
  /** True when the caller explicitly asked for a live recompute; only ever logged, never trusted. */
  requestedByApi?: boolean;
}

/**
 * Classify one already-uploaded DocumentVersion and, when OCR is available for its mime type,
 * extract its text into the AiDocumentClassification row.
 *
 * Enqueued by the API's AI classification endpoint (`POST /ai-assistant/documents/classifications`),
 * which refuses a version that has not cleared the virus scan — and the processor re-checks that
 * gate before touching anything, so a job that outlives a re-scan fails closed.
 *
 * SECURITY: the payload carries ids and a *derived* label hint only — never the file itself. The
 * processor builds its tenant-scoped client from `tenantId` alone and re-checks that the document
 * and version still belong to that tenant and are still CLEAN before touching anything, so a
 * tampered payload cannot be used to read another tenant's object storage.
 */
export interface AiDocumentProcessingJobData extends TenantJobData {
  documentId: string;
  versionId: string;
  /** What the processor should attempt. OCR is skipped (not failed) when the mime type has no
   *  configured extractor. */
  steps: Array<'CLASSIFY' | 'OCR'>;
  /** True when a human has already confirmed/rejected this version's classification — set by the
   *  review endpoint so a re-run never overwrites a verified decision. */
  skipIfReviewed?: boolean;
}
