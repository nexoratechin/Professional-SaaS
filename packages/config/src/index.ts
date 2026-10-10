import { z } from 'zod';

const boolFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const boolFromStringDefaultTrue = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalUrl = z
  .union([z.string().url(), z.literal('')])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY (RS256 PEM) is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY (RS256 PEM) is required'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** SECURITY: off by default. When true, PasswordResetService / EmailVerificationService log the
   *  raw single-use token to the application log — a dev/e2e convenience for a deployment with no
   *  email provider yet. Never enable in production: anyone with log access could take over any
   *  account for which they can trigger a reset. */
  AUTH_DEBUG_TOKEN_LOGGING: boolFromString,

  /** AES-256-GCM key (64 hex chars = 32 bytes) encrypting MFA/TOTP secrets at rest — generate
   * with `openssl rand -hex 32`. Distinct from the JWT keypair: this protects a symmetric secret
   * that must be decrypted to verify a 6-digit code, never asserted/signed like a token claim. */
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  /** AES-256-GCM key (64 hex chars = 32 bytes) encrypting attendance device secrets (push token,
   * vendor comm key) at rest — generate with `openssl rand -hex 32`. Reversible (not hashed)
   * because device HMAC verification / pull adapters need the raw secret. */
  DEVICE_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'DEVICE_SECRET_KEY must be 64 hex characters (32 bytes)'),

  /** AES-256-GCM key (64 hex chars = 32 bytes) encrypting notification provider credentials
   * (SMTP passwords, SMS/WhatsApp/push gateway API keys) at rest — generate with
   * `openssl rand -hex 32`. Distinct from MFA/device keys so one credential class leaking never
   * decrypts another. Used by apps/api (encrypt on save) and apps/worker (decrypt on delivery). */
  NOTIFICATION_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'NOTIFICATION_SECRET_KEY must be 64 hex characters (32 bytes)'),

  /** AES-256-GCM key (64 hex chars = 32 bytes) encrypting *tenant-configured third-party
   * credentials* at rest — payment gateway keys, accounting API tokens, LMS/RFID/identity vendor
   * secrets — generate with `openssl rand -hex 32`. Reversible (not hashed) because adapters and
   * webhook signature verification need the raw secret. Distinct from MFA/device/notification keys
   * so one credential class leaking never decrypts another; this class is the one that holds
   * third-party vendor secrets for an arbitrary number of tenants. */
  INTEGRATION_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'INTEGRATION_SECRET_KEY must be 64 hex characters (32 bytes)'),

  /** Web Push (VAPID) keys for browser/PWA push. Generated once per environment with
   *  `npx web-push generate-vapid-keys`. Optional: when unset, PUSH delivery falls back to the
   *  tenant's configured gateway provider, exactly as before. The PUBLIC key is safe to hand to
   *  browsers (served by GET /push/config); the PRIVATE key must never leave the server. */
  VAPID_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  VAPID_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  VAPID_SUBJECT: z.string().default('mailto:admin@college-erp.local'),

  // --- AI ERP Assistant ---------------------------------------------------------------
  // All optional, all defaulting to "off". The assistant's *data* path (natural-language queries,
  // risk insights, report/draft generation from already-scoped queries) works with no provider
  // configured at all - it is scoped SQL plus deterministic formatting, which is why the feature
  // is useful and testable before anyone buys an API key. Only the optional narration / drafting /
  // OCR steps need a provider.

  /** Master switch. When false the AI module's endpoints refuse even if RBAC and entitlements
   *  pass, so an operator can turn the whole surface off without editing plans. */
  AI_ENABLED: boolFromString,
  /** `none` disables narration/drafting/OCR (same effect as no API key). */
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai', 'mock']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  /** Hard ceiling on rows an assistant answer may return. Enforced on top of the reporting
   *  engine's own limits: the assistant is an interactive surface, not a data dump. */
  AI_MAX_ROWS: z.coerce.number().int().positive().max(500).default(50),
  /** Ceiling on characters of extracted OCR text persisted per document version, so a 200-page
   *  PDF cannot bloat the row (or the review UI) on its first classification. */
  AI_MAX_EXTRACTED_TEXT_CHARS: z.coerce.number().int().positive().default(20000),
  /** Confidence below which a classification is queued for human review instead of accepted. */
  AI_AUTO_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),
  /** Optional generic OCR endpoint returning { text: string }. Unset disables the OCR step
   *  (classification still runs). Same optional-URL treatment as VIRUS_SCAN_API_URL. */
  AI_OCR_API_URL: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  AI_OCR_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString,

  /** Global cap on a single document file upload in bytes (25 MiB). Overridable per
   *  DocumentType via its maxSizeBytes. */
  DOCUMENT_MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(26_214_400),

  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  /** REST platform defaults — the global @nestjs/throttler window used by every tenant route.
   *  Per-endpoint limits (e.g. the brute-force guard on /auth/login) override these via
   *  @Throttle(). Milliseconds for ttl, requests per window for limit. */
  THROTTLE_TTL: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  /** How long an Idempotency-Key stays cached (seconds). Default 24h. Successful responses are
   *  replayed verbatim on a retry with the same key; failures release the key immediately. */
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  /** Base URL embedded in certificate QR codes so an offline printed document can be verified
   *  by anyone scanning it (resolves to the public /verify/certificate page). */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Payment gateway adapter used for order reconciliation: `mock` (deterministic, offline) or
   *  `razorpay` (adapter not yet implemented). */
  PAYMENTS_GATEWAY: z.enum(['mock', 'razorpay']).default('mock'),
  /** In prod, tenant is resolved from subdomain; dev/CI fall back to the X-Tenant-Slug header. */
  TENANT_HEADER_FALLBACK: boolFromString,

  // --- Production observability --------------------------------------------------------------
  // Structured logging, metrics, health, error tracking and alerting. All defaults are safe for
  // local development; see docs/observability.md for the full operator guide.

  /** Log rendering: `json` (one object per line — production default) or `text` (dev default).
   *  When unset, NODE_ENV decides: json in production, text elsewhere. */
  LOG_FORMAT: z.enum(['json', 'text']).optional(),
  /** Prometheus text endpoint at GET /metrics. When false the endpoint 404s. */
  METRICS_ENABLED: boolFromStringDefaultTrue,
  /** When set, /metrics requires `Authorization: Bearer <token>` (or X-Metrics-Token). */
  METRICS_TOKEN: optionalString,
  /** Adds the tenant slug label to per-tenant request counters. Off by default — high cardinality. */
  METRICS_INCLUDE_TENANT_LABELS: boolFromString,
  /** Queries slower than this are counted and logged as warnings (milliseconds). */
  SLOW_QUERY_MS: z.coerce.number().int().positive().default(500),
  /** Timeout for each dependency probe behind /health/ready (milliseconds). */
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  /** Master switch for the alert evaluation loop (dispatch is additionally gated on the webhook). */
  ALERTING_ENABLED: boolFromStringDefaultTrue,
  /** How often the alert engine evaluates every rule (milliseconds). */
  ALERT_EVAL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /** Slack-compatible / generic JSON webhook that receives alert dispatch and resolve payloads. */
  ALERT_WEBHOOK_URL: optionalUrl,
  /** Suppression window per rule+scope after a dispatch (minutes). */
  ALERT_DEDUPE_MINUTES: z.coerce.number().int().positive().default(15),
  /** Number of worker replicas this deployment expects to heartbeat; 0 disables the worker alert. */
  WORKER_EXPECTED_REPLICAS: z.coerce.number().int().min(0).default(1),
  /** Error tracker: master switch, optional external webhook, and DB persistence of deduped errors. */
  ERROR_TRACKING_ENABLED: boolFromStringDefaultTrue,
  ERROR_TRACKING_WEBHOOK_URL: optionalUrl,
  ERROR_TRACKING_PERSIST: boolFromStringDefaultTrue,

  // --- Enterprise database isolation (optional; off by default) ------------------------------
  // The default architecture remains shared PostgreSQL + tenant_id. These knobs enable the opt-in
  // dedicated-schema / dedicated-database modes. See docs/enterprise-database-isolation.md.

  /** Master switch. When false, creating/upgrading a tenant to a DEDICATED_* mode is refused. */
  TENANT_DB_ISOLATION_ENABLED: boolFromString,
  /** AES-256-GCM key (64 hex chars) encrypting enterprise tenant connection URLs at rest.
   *  Generate with `openssl rand -hex 32`. Required only when isolation is enabled. */
  TENANT_DB_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TENANT_DB_SECRET_KEY must be 64 hex characters (32 bytes)')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** Privileged URL used to CREATE DATABASE / CREATE SCHEMA. Defaults to DATABASE_URL. */
  TENANT_DB_ADMIN_URL: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  TENANT_DB_SCHEMA_PREFIX: z.string().default('tenant_'),
  TENANT_DB_DATABASE_PREFIX: z.string().default('college_erp_tenant_'),
  /** `auto` applies schema migrations inline during provisioning; `manual` creates the store and
   *  leaves migrations to an operator/DBA. */
  TENANT_DB_MIGRATION_MODE: z.enum(['auto', 'manual']).default('auto'),
  /** Absolute path to schema.prisma for the migration executor; auto-resolved when unset. */
  TENANT_DB_PRISMA_SCHEMA_PATH: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** Max dedicated Prisma clients kept open per process. */
  TENANT_DB_MAX_CLIENTS: z.coerce.number().int().positive().default(10),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** Same 64-hex AES-256-GCM key as the API — the worker decrypts notification provider
   * credentials at delivery time. */
  NOTIFICATION_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'NOTIFICATION_SECRET_KEY must be 64 hex characters (32 bytes)'),
  /** Same 64-hex AES-256-GCM key as the API — the worker decrypts tenant-configured third-party
   * credentials to actually call a provider (or verify an inbound webhook signature) on behalf of
   * a tenant. Separate from NOTIFICATION_SECRET_KEY because these are third-party vendor secrets,
   * not our own delivery credentials. */
  INTEGRATION_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'INTEGRATION_SECRET_KEY must be 64 hex characters (32 bytes)'),

  /** Same VAPID keypair as the API — the worker signs and sends Web Push messages for PUSH
   *  notifications whose recipient has registered a browser subscription. */
  VAPID_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  VAPID_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  VAPID_SUBJECT: z.string().default('mailto:admin@college-erp.local'),

  /** Object-storage credentials for the document virus-scan + retention processors, which
   *  delete/quarantine infected or expired objects (the same bucket the API signs URLs into). */
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString,

  /** Same AI provider settings as the API — the worker runs the OCR/classification step and must
   *  classify/extract with exactly the provider the API would have, or a re-run would disagree
   *  with the original. Unset AI_API_KEY means the worker records NO_TEXT rather than failing the
   *  document: classification is best-effort, the virus scan is not. */
  AI_ENABLED: boolFromString,
  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai', 'mock']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_MAX_EXTRACTED_TEXT_CHARS: z.coerce.number().int().positive().default(20000),
  AI_AUTO_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),
  AI_OCR_API_URL: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  AI_OCR_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  /** Which virus scanner the DocumentVirusScanProcessor uses: `mock` (dev default — every file
   *  scans clean unless the payload opts into a simulated infection), `clamav` (clamd TCP
   *  protocol), or `http` (generic scanning API returning { clean: boolean }). */
  VIRUS_SCAN_PROVIDER: z.enum(['mock', 'clamav', 'http']).default('mock'),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  /** Optional generic scanning API (used when VIRUS_SCAN_PROVIDER=http). Empty string (e.g. an
   *  unset compose var) is treated as unset. */
  VIRUS_SCAN_API_URL: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  VIRUS_SCAN_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  /** Base URL embedded in certificate QR codes — MUST match the API's, or a worker-generated
   *  certificate and an API-generated one would QR-code to different verify pages. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Payment gateway adapter the reconciliation queue calls: `mock` or `razorpay`. */
  PAYMENTS_GATEWAY: z.enum(['mock', 'razorpay']).default('mock'),

  // --- Production observability --------------------------------------------------------------
  // The worker exposes its own health/metrics HTTP surface (default :3100), heartbeats into Redis
  // so the API can alert when no worker is alive, and reports failures into the same window
  // counters the API's alert engine reads. See docs/observability.md.

  /** Log rendering: `json` (production default) or `text` (dev default). */
  LOG_FORMAT: z.enum(['json', 'text']).optional(),
  /** Prometheus text endpoint on the worker health server. When false the endpoint 404s. */
  METRICS_ENABLED: boolFromStringDefaultTrue,
  /** When set, worker /metrics requires `Authorization: Bearer <token>` (or X-Metrics-Token). */
  METRICS_TOKEN: optionalString,
  /** Queries slower than this are counted and logged as warnings (milliseconds). */
  SLOW_QUERY_MS: z.coerce.number().int().positive().default(500),
  /** Timeout for each dependency probe behind /health/ready (milliseconds). */
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  /** Enables the worker's health/metrics HTTP server (needed by container healthchecks). */
  WORKER_HEALTH_ENABLED: boolFromStringDefaultTrue,
  /** Port for the worker health/metrics server (not exposed publicly by default). */
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3100),
  /** How often the worker writes its Redis heartbeat (milliseconds). */
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  /** TTL of the Redis heartbeat key; must exceed the interval (seconds). */
  WORKER_HEARTBEAT_TTL_SECONDS: z.coerce.number().int().positive().default(45),
  /** Error tracker: master switch, optional external webhook, and DB persistence of deduped errors. */
  ERROR_TRACKING_ENABLED: boolFromStringDefaultTrue,
  ERROR_TRACKING_WEBHOOK_URL: optionalUrl,
  ERROR_TRACKING_PERSIST: boolFromStringDefaultTrue,

  // --- Enterprise database isolation (optional; off by default) ------------------------------
  // The worker routes a DEDICATED_* tenant's jobs to its schema/database using the same registry
  // the API populates. These must match the API's settings. See
  // docs/enterprise-database-isolation.md.
  TENANT_DB_ISOLATION_ENABLED: boolFromString,
  /** Same 64-hex AES-256-GCM key as the API — the worker decrypts connection URLs to route jobs. */
  TENANT_DB_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TENANT_DB_SECRET_KEY must be 64 hex characters (32 bytes)')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  TENANT_DB_MAX_CLIENTS: z.coerce.number().int().positive().default(10),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnv<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
