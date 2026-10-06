import { z } from 'zod';

const boolFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

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
  /** In prod, tenant is resolved from subdomain; dev/CI fall back to the X-Tenant-Slug header. */
  TENANT_HEADER_FALLBACK: boolFromString,
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
