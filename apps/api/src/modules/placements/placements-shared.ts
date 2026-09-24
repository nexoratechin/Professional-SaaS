/**
 * Shared helpers for the placements module services — the audit-record helper (module
 * AUDIT_MODULES.PLACEMENTS) plus the reusable Student-lite select used in list/nested reads.
 */
import { AUDIT_MODULES } from '@college-erp/auth';
import { AuditService } from '../audit/audit.service';

export interface PlacementAuditContext {
  tenantId: string;
  actorUserId: string;
}

/** Records one placements audit entry under AUDIT_MODULES.PLACEMENTS (see packages/auth
 * audit-keys.ts for the placement action constants). */
export async function recordPlacementAudit(
  audit: AuditService,
  ctx: PlacementAuditContext,
  action: string,
  entityType: string,
  entityId: string,
  after?: unknown,
  before?: unknown,
): Promise<void> {
  await audit.record({
    scope: 'TENANT',
    tenantId: ctx.tenantId,
    actorType: 'USER',
    actorUserId: ctx.actorUserId,
    action,
    module: AUDIT_MODULES.PLACEMENTS,
    entityType,
    entityId,
    before,
    after,
  });
}

/** Student-lite projection shared by every placements read that embeds a student. */
export const placementStudentSelect = {
  id: true,
  admissionNumber: true,
  fullName: true,
  email: true,
  primaryPhone: true,
  programId: true,
  batchId: true,
  academicYearId: true,
  program: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true } } } },
  campus: { select: { id: true, name: true } },
} as const;

/** Rounds an ISO date string into a Date (or returns undefined) — date fields are optional. */
export function toDate(value: string | undefined | null, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Invalid date for ${field}: ${value}`);
  return d;
}

/** Converts an int cents value into a readable lakh string (e.g. "12.5 LPA"); null when unknown. */
export function formatPackageCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `${(cents / 1_000_000).toFixed(cents % 1_000_000 === 0 ? 0 : 2)} LPA`;
}