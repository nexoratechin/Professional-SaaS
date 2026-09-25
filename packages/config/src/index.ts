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

  /** Object-storage credentials for the document virus-scan + retention processors, which
   *  delete/quarantine infected or expired objects (the same bucket the API signs URLs into). */
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString,

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
