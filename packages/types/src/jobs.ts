export const QUEUE_NAMES = {
  /**
   * Notification orchestration: one job per Notification row. Resolves entitlement, recipient
   * preference and addresses, then fans EMAIL/SMS/WHATSAPP out onto their dedicated transport
   * queues and delivers IN_APP/PUSH inline (see apps/worker's NotificationsProcessor).
   */
  NOTIFICATIONS: 'notifications',
  /** Dedicated email transport queue (the actual SMTP/provider send happens here). */
  EMAILS: 'emails',
  /** Dedicated SMS transport queue. */
  SMS: 'sms',
  /** Dedicated WhatsApp transport queue. */
  WHATSAPP: 'whatsapp',
  /** Async PDF artifact rendering (certificate re-renders, statements, ID cards, ...). */
  PDF_GENERATION: 'pdf-generation',
  /** Async certificate/transcript issuance (number allocation, snapshot, PDF). */
  CERTIFICATE_GENERATION: 'certificate-generation',
  /** Reconciles recorded gateway payments against the provider's current order status. */
  PAYMENT_RECONCILIATION: 'payment-reconciliation',
  /** Terminal failures are re-delivered here for inspection/replay instead of being lost. */
  DEAD_LETTER: 'dead-letter',
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
  /** Outbound calls to a tenant's configured third-party system (apps/worker's integration queues). */
  INTEGRATION_OPERATIONS: 'integration-operations',
  /** Inbound-data pulls/periodic sync fan-out (apps/worker's integration queues). */
  INTEGRATION_SYNC: 'integration-sync',
  /** Bulk CSV/XLSX import processing (apps/worker's data-import queue). */
  DATA_IMPORTS: 'data-imports',
  /** Scheduled PostgreSQL backups, backup verification/pruning and Redis snapshots. */
  BACKUP: 'backup',
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

/**
 * One queued call to a tenant's configured third-party system (payment gateway, accounting
 * export, LMS push, SMS/WhatsApp handoff, identity lookup — whatever `Integration.category` says).
 *
 * The processor resolves the integration by `integrationId` *through the tenant-scoped client
 * built from `tenantId`* and re-checks that the row still belongs to that tenant and is enabled.
 * The job payload deliberately carries no credentials and no URL: the adapter configuration lives
 * encrypted on the Integration row, so a tampered or replayed payload cannot redirect a call at a
 * host of its choosing or exfiltrate a secret that was not in the payload to begin with.
 *
 * `operationId` points at the pre-created IntegrationOperation row, so a duplicate delivery
 * (BullMQ at-least-once) sees a terminal status and returns without issuing the call twice.
 */
export interface IntegrationOperationJobData extends TenantJobData {
  integrationId: string;
  operationId: string;
  /** Retried manually via POST /integrations/operations/:id/retry; ignored by the processor,
   *  which takes its attempts/backoff from the retry classification of the recorded error. */
  isManualRetry?: boolean;
}

/**
 * Same cross-tenant maintenance-sweep shape as DocumentRetentionSweepJobData: the sync sweep finds
 * every tenant's enabled Integration whose config asks for periodic sync (via the unscoped
 * platform client), then runs each run through its own tenant-scoped client. Never a job scoped to
 * a single tenant up front — one sweep covers every tenant's schedule.
 */
export type IntegrationSyncSweepJobData = Record<string, never>;

/**
 * One synchronization run. Either `syncRunId` is set (the API created the run row and queued it —
 * an operator-triggered or webhook-triggered sync) or `integrationId` is set (the sweep discovered
 * the integration and the processor creates the run row itself, which keeps the cross-tenant sweep
 * free of tenant-scoped writes).
 *
 * Like IntegrationOperationJobData, the payload carries ids only: the sync cursor, page size and the
 * entity type come from the IntegrationSyncRun / Integration rows, so a tampered payload cannot
 * redirect a sync at an entity type or range the tenant did not configure.
 */
export interface IntegrationSyncRunJobData extends TenantJobData {
  integrationId?: string;
  syncRunId?: string;
  entityType?: string;
  /** Defaults to PULL_SYNC in the processor when absent. */
  mode?: 'PULL_SYNC' | 'PUSH_SYNC';
}

/**
 * One bulk CSV/XLSX import run. Enqueued by the API when a job row is created (and again by the
 * retry endpoint). The processor downloads the stored file through the tenant-scoped storage
 * client, re-parses and validates it with @college-erp/imports, then applies the valid rows
 * through the tenant-scoped Prisma client. The payload carries ids only.
 *
 * `rowNumbers` is set for a partial retry: the processor reprocesses just those source rows
 * (typically the previously failed ones) instead of the whole file.
 */
export interface DataImportJobData extends TenantJobData {
  jobId: string;
  rowNumbers?: number[];
}

/**
 * Delivery of ONE Notification row over that row's dedicated transport queue (emails/sms/whatsapp).
 * The orchestrating `notifications` processor resolves audience/entitlement/preference and then
 * hands the row off; the channel processor performs the provider send, delivery log and status
 * transition. Same tenant-context contract as NotificationJobData: ids only, tenantId is the only
 * carrier of tenancy.
 */
export interface ChannelDeliveryJobData extends TenantJobData {
  notificationId: string;
}

/** Certificate types the async issuance pipeline knows how to render. */
export type CertificateGenerationKind = 'GENERATE';

/**
 * Async certificate issuance: moves a REQUESTED certificate through number allocation and the
 * GENERATED status while producing its PDF. Backed by the StudentCertificate row itself.
 */
export interface CertificateGenerationJobData extends TenantJobData {
  certificateId: string;
  actorUserId: string;
  /** Optional template override for a generation run. */
  templateId?: string;
}

/**
 * Generic async PDF artifact. Backed by a tenant-owned GeneratedDocument row that carries the
 * render input and the resulting status, so a client can poll `GET /generated-documents/:id`.
 */
export interface PdfGenerationJobData extends TenantJobData {
  generatedDocumentId: string;
}

/**
 * Reconcile one recorded gateway payment against the provider's current order status.
 *
 * SaaS billing `Payment` rows are platform control-plane data (like Invoice/Subscription), so the
 * processor reaches them through the unscoped platform client with an explicit tenantId filter —
 * the job payload carries tenantId for the audit trail and ownership checks, not for a
 * tenant-guard extension.
 */
export interface PaymentReconciliationJobData extends TenantJobData {
  paymentId: string;
  /** True when a human explicitly triggered the reconciliation (affects logging only). */
  requestedByApi?: boolean;
}

/** Cross-tenant maintenance sweep over PENDING gateway payments past their reconciliation window. */
export type PaymentReconciliationSweepJobData = Record<string, never>;

/**
 * A job that exhausted its retries (or was discarded) on its source queue. DeadLetterProcessor
 * persists it for operators: the payload is preserved verbatim so it can be replayed by hand.
 */
export interface DeadLetterJobData {
  sourceQueue: string;
  sourceJobId: string | null;
  jobName: string;
  tenantId: string | null;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  failedAt: string;
  payload: unknown;
}

/**
 * Scheduled PostgreSQL backup. A platform-wide maintenance job — the logical dump covers the whole
 * shared database, so (like the other cross-tenant sweeps) it deliberately does NOT extend
 * TenantJobData. Verification of the produced archive runs inline; the optional scratch-database
 * restore verification is gated by BACKUP_VERIFY_RESTORE_ENABLED or `verifyRestore: true`.
 */
export interface PostgresBackupJobData {
  requestedBy?: 'schedule' | 'manual';
  /** Force restore-verification for this run even when the env default is off. */
  verifyRestore?: boolean;
}

/**
 * Scheduled Redis snapshot: BGSAVE + persistence assessment, plus an RDB export to object storage
 * when redis-cli is available and export is enabled.
 */
export interface RedisSnapshotJobData {
  requestedBy?: 'schedule' | 'manual';
}

/** GFS retention sweep over stored backup archives (cross-tenant by construction). */
export type BackupPruneJobData = Record<string, never>;
