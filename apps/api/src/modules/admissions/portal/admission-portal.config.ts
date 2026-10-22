import type { TenantConfigAdmissionsPortal } from '@college-erp/types';

/**
 * Resolved configuration for the public admissions portal.
 *
 * Three layers feed it, most-specific last:
 *   1. module defaults (this file) — safe values for a college that configured nothing;
 *   2. the tenant's `TenantConfiguration.data.admissionsPortal` section;
 *   3. the session's `portalInstructions` JSON (AdmissionSession), because two intakes in the same
 *      college can legitimately run with different copy, consent text and upload limits.
 *
 * Nothing here is secret: the resolved values are returned to the public form endpoint, so treat
 * every field as published.
 */
export interface AdmissionPortalConfig {
  /** Tenant-wide switch. A session also needs portalEnabled + a publicSlug to appear. */
  enabled: boolean;
  consentText: string;
  consentVersion: string;
  supportEmail: string | null;
  supportPhone: string | null;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  draftRetentionDays: number;
  applicantTokenTtlSeconds: number;
  resumeTokenTtlDays: number;
  otp: {
    ttlSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    maxSendsPerAccess: number;
  };
}

export const DEFAULT_CONSENT_TEXT =
  'I confirm that the information and documents I submit are true, complete and mine. I consent to ' +
  'this institution processing my personal data for admission, communication and statutory record-keeping, ' +
  'and I understand that false information may lead to my application being cancelled.';

export const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const DEFAULT_MAX_UPLOAD_MB = 10;
const MAX_MAX_UPLOAD_MB = 25;
const DEFAULT_DRAFT_RETENTION_DAYS = 30;
const MAX_DRAFT_RETENTION_DAYS = 180;

/** ~45 minutes: long enough to fill a form, short enough that a leaked token is near-useless. */
const APPLICANT_TOKEN_TTL_SECONDS = 45 * 60;
const RESUME_TOKEN_TTL_DAYS = 30;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function pickString(value: unknown, fallback: string | null): string | null {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function pickMimeTypes(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(entry));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : fallback;
}

export function resolvePortalConfig(
  tenantSection?: Partial<TenantConfigAdmissionsPortal> | null,
  sessionInstructions?: Record<string, unknown> | null,
): AdmissionPortalConfig {
  const tenant = tenantSection ?? {};
  const session = sessionInstructions ?? {};

  const maxUploadMb = clampInt(
    session.maxUploadMb ?? tenant.maxUploadMb,
    DEFAULT_MAX_UPLOAD_MB,
    1,
    MAX_MAX_UPLOAD_MB,
  );

  return {
    // A tenant-level "off" always wins; a session cannot switch the portal on for a college that
    // has disabled it (e.g. after a data-protection incident).
    enabled: tenant.enabled === false ? false : true,
    consentText: pickString(session.consentText, pickString(tenant.consentText, DEFAULT_CONSENT_TEXT)) as string,
    consentVersion: pickString(session.consentVersion, pickString(tenant.consentVersion, 'v1')) as string,
    supportEmail: pickString(session.supportEmail, pickString(tenant.supportEmail, null)),
    supportPhone: pickString(session.supportPhone, pickString(tenant.supportPhone, null)),
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    allowedMimeTypes: pickMimeTypes(session.allowedMimeTypes ?? tenant.allowedMimeTypes, [
      ...DEFAULT_ALLOWED_MIME_TYPES,
    ]),
    draftRetentionDays: clampInt(
      session.draftRetentionDays ?? tenant.draftRetentionDays,
      DEFAULT_DRAFT_RETENTION_DAYS,
      1,
      MAX_DRAFT_RETENTION_DAYS,
    ),
    applicantTokenTtlSeconds: APPLICANT_TOKEN_TTL_SECONDS,
    resumeTokenTtlDays: RESUME_TOKEN_TTL_DAYS,
    otp: {
      ttlSeconds: 10 * 60,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
      maxSendsPerAccess: 20,
    },
  };
}

/** Public view of the config — what the applicant-facing form is allowed to see. */
export function publicPortalConfig(config: AdmissionPortalConfig) {
  return {
    consentText: config.consentText,
    consentVersion: config.consentVersion,
    supportEmail: config.supportEmail,
    supportPhone: config.supportPhone,
    maxUploadBytes: config.maxUploadBytes,
    allowedMimeTypes: config.allowedMimeTypes,
  };
}
