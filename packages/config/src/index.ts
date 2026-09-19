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

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString,

  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** In prod, tenant is resolved from subdomain; dev/CI fall back to the X-Tenant-Slug header. */
  TENANT_HEADER_FALLBACK: boolFromString,
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
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
