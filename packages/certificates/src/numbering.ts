/**
 * Certificate numbering — tenant-driven chains like `CERT-TRA-0042`.
 *
 * Number structure: `<prefix>-<type-tail>-<padded-sequence>`. The prefix comes from the
 * template's `numberingJson.prefix`, falling back to the tenant configuration
 * (`numbering.certificatePrefix`) and finally to `CERT`. The type tail keeps each certificate
 * kind in its own visual sequence while still satisfying the global
 * `@@unique([tenantId, certificateNumber])` constraint.
 */
import type { CertificateTypeDto } from '@college-erp/types';

export interface CertificateNumbering {
  prefix?: string | null;
  start?: number | null;
  padding?: number | null;
}

export const DEFAULT_PREFIX = 'CERT';
export const DEFAULT_PADDING = 4;

export const TYPE_TAILS: Record<string, string> = {
  BONAFIDE: 'BON',
  PROVISIONAL: 'PRO',
  MIGRATION: 'MIG',
  TRANSCRIPT: 'TRA',
  TRANSFER_CERTIFICATE: 'TRF',
  GRADE_CARD: 'GRA',
  MARKSHEET: 'MAR',
  CHARACTER_CERTIFICATE: 'CHA',
  TESTIMONIAL: 'TES',
  OTHER: 'CUS',
};

const NUMBER_PATTERN = /^(.+)-([A-Z0-9]{2,4})-(\d+)$/;

/** Resolve the effective prefix for a certificate from template numbering and tenant config. */
export function resolveCertificatePrefix(
  numbering: CertificateNumbering | null | undefined,
  tenantConfigNumbering: { certificatePrefix?: string } | null | undefined,
): string {
  const prefix = numbering?.prefix?.trim() || tenantConfigNumbering?.certificatePrefix?.trim();
  return (prefix || DEFAULT_PREFIX).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
}

export function resolvePadding(numbering: CertificateNumbering | null | undefined): number {
  const padding = numbering?.padding;
  if (typeof padding === 'number' && padding >= 1 && padding <= 12) return padding;
  return DEFAULT_PADDING;
}

export function typeTail(type: CertificateTypeDto | string): string {
  return TYPE_TAILS[type as keyof typeof TYPE_TAILS] ?? 'CUS';
}

export function formatCertificateNumber(prefix: string, tail: string, sequence: number, padding: number): string {
  return `${prefix}-${tail}-${String(sequence).padStart(padding, '0')}`;
}

/**
 * Parse the highest sequence already present for a `prefix-tail-` chain among existing numbers.
 * Returns `start - 1` when none is found, so the next number is the template start (default 1).
 */
export function highestSequence(existingNumbers: string[], prefix: string, tail: string, start: number): number {
  const marker = `${prefix}-${tail}-`;
  let max = start - 1;
  for (const number of existingNumbers) {
    if (!number.startsWith(marker)) continue;
    const match = NUMBER_PATTERN.exec(number);
    if (!match) continue;
    const seq = Number.parseInt(match[3] ?? '', 10);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max;
}