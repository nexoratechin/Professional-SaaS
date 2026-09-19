/**
 * Device ingest pipeline — the single normalized path every attendance device event flows through
 * regardless of how it arrived (HTTP_PUSH, adapter pull, manual upload, reconciliation):
 *
 *   authenticate (bearer token / optional HMAC signature)
 *   → normalize vendor payload → deterministic dedupe key (DB-unique)
 *   → persist AttendanceDeviceLog (QUEUED) → resolve device↔person mapping
 *   → APPLY: upsert StudentAttendance (DEVICE mark, session-linked) or FacultyAttendance
 *     (daily check-in), preserving MANUAL marks — or mark UNMAPPED/REJECTED/ERROR.
 *
 * Every capture channel is gated by its granular attendance entitlement at ingest time so a
 * device whose plan lapses stops applying marks. Per-event problems are NEVER silent — they are
 * persisted as DEVICE error/unmapped/rejected log rows an operator can reconcile. Durable
 * activities land in the audit trail (module 'attendance').
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import {
  AttendanceSessionStatus,
  AttendanceStatus,
  CourseRegistrationStatus,
} from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DeviceSecretCipher } from '../../../common/security/device-secret-cipher';
import { EntitlementsGatewayService } from '../../rbac/entitlements-gateway.service';
import { buildDeviceDedupeKey, normalizeExternalPersonId } from './device-dedupe';
import { normalizeDeviceEvent, type NormalizedDeviceEvent } from './device-normalizers';
import { deviceEntitlementKey } from './device-entitlement';
import { DEVICE_MARK_METHOD, MANUAL_MARK_METHOD, type DeviceIngestSource } from './device-constants';
import type { DeviceEventRowDto } from '../attendance-device.dto';

type Client = PrismaClient;

export interface IngestedEventCounts {
  received: number;
  applied: number;
  duplicate: number;
  unmapped: number;
  rejected: number;
  error: number;
}

export interface DeviceIngestContext {
  tenantId: string;
  device: { id: string; code: string; deviceType: string; status: string };
  source: DeviceIngestSource;
  payload?: unknown;
  rows?: DeviceEventRowDto[];
  actorUserId?: string | null;
  verifyHmac?: {
    canonicalBody: string;
    signature: string | undefined;
    timestamp: string | undefined;
    secret: string;
    maxSkewSeconds: number;
  } | null;
}

interface DeviceRules {
  autoApply: boolean;
  gracePeriodMinutes: number;
  ingestEnabled: boolean;
  deviceSyncEnabled: boolean;
  ingestMaxSkewSeconds: number;
}

const ROSTER_STATUSES: CourseRegistrationStatus[] = [CourseRegistrationStatus.REGISTERED, CourseRegistrationStatus.CONFIRMED];

/** Statuses reconciliation may re-process. */
export const PROCESSABLE_LOG_STATUSES = ['QUEUED', 'UNMAPPED', 'REJECTED', 'ERROR'];

const EMPTY_COUNTS: IngestedEventCounts = { received: 0, applied: 0, duplicate: 0, unmapped: 0, rejected: 0, error: 0 };

const DEFAULT_DEVICE_RULES: DeviceRules = {
  autoApply: true,
  gracePeriodMinutes: 10,
  ingestEnabled: true,
  deviceSyncEnabled: true,
  ingestMaxSkewSeconds: 300,
};

interface PendingLog {
  log: { id: string; eventType: string; externalPersonId: string | null; capturedAt: Date };
  event: NormalizedDeviceEvent;
}

@Injectable()
export class DeviceIngestService {
  private readonly logger = new Logger(DeviceIngestService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly deviceSecretCipher: DeviceSecretCipher,
    private readonly entitlements: EntitlementsGatewayService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  /** Resolves tenant-configuration rules for the device pipeline. */
  async deviceRules(tenantId: string): Promise<DeviceRules> {
    const row = await this.client.tenantConfiguration.findFirst({ where: { tenantId } });
    const section = (row?.data as any)?.attendance ?? {};
    return {
      autoApply: typeof section.autoApplyDeviceMarks === 'boolean' ? section.autoApplyDeviceMarks : DEFAULT_DEVICE_RULES.autoApply,
      gracePeriodMinutes:
        typeof section.gracePeriodMinutes === 'number' ? section.gracePeriodMinutes : DEFAULT_DEVICE_RULES.gracePeriodMinutes,
      ingestEnabled:
        typeof section.deviceIngestEnabled === 'boolean' ? section.deviceIngestEnabled : DEFAULT_DEVICE_RULES.ingestEnabled,
      deviceSyncEnabled:
        typeof section.deviceSyncEnabled === 'boolean' ? section.deviceSyncEnabled : DEFAULT_DEVICE_RULES.deviceSyncEnabled,
      ingestMaxSkewSeconds:
        typeof section.ingestMaxSkewSeconds === 'number' ? section.ingestMaxSkewSeconds : DEFAULT_DEVICE_RULES.ingestMaxSkewSeconds,
    };
  }

  /**
   * Entry point for a batch of device events: normalize → dedupe → persist → apply. Throws only
   * on HARD failures (inactive device, disabled ingestion, lost entitlement, bad signature) so the
   * controller can answer 400/401; per-row problems never throw — they become persisted log rows
   * with a status an operator can reconcile.
   */
  async ingest(ctx: DeviceIngestContext): Promise<IngestedEventCounts> {
    const { tenantId, device } = ctx;
    if (device.status !== 'ACTIVE') {
      throw new BadRequestException(`Attendance device ${device.code} is not active.`);
    }

    const entitlementKey = deviceEntitlementKey(device.deviceType);
    if (!(await this.entitlements.canUse(tenantId, entitlementKey))) {
      throw new BadRequestException(
        `This tenant is no longer entitled to ${device.deviceType.toLowerCase()} attendance capture (${entitlementKey}).`,
      );
    }

    const cfg = await this.deviceRules(tenantId);
    if (!cfg.ingestEnabled) {
      throw new BadRequestException('Device ingestion is disabled for this tenant.');
    }

    if (ctx.verifyHmac?.signature && ctx.verifyHmac.timestamp) {
      const skewSeconds = Math.abs(Date.now() / 1000 - Number(ctx.verifyHmac.timestamp));
      if (!Number.isFinite(Number(ctx.verifyHmac.timestamp)) || skewSeconds > cfg.ingestMaxSkewSeconds) {
        throw new UnauthorizedException('Device push timestamp is outside the allowed skew window.');
      }
      const verified = this.deviceSecretCipher.verifyHmacSignature(
        ctx.verifyHmac.canonicalBody,
        ctx.verifyHmac.signature,
        ctx.verifyHmac.timestamp,
        ctx.verifyHmac.secret,
      );
      if (!verified) {
        throw new UnauthorizedException('Device push signature verification failed.');
      }
    }

    // ── Normalize the batch ──────────────────────────────────────────────────
    const extracted = this.extractEvents(ctx.payload, ctx.rows);
    const counts: IngestedEventCounts = { ...EMPTY_COUNTS };
    const errorEntries = extracted.rejected.map((r) => ({ raw: r.raw, note: `Normalization failed: ${r.reason}` }));
    counts.received = extracted.normalized.length + errorEntries.length;

    // ── Dedupe + persist the new QUEUED logs ─────────────────────────────────
    let pending: PendingLog[] = [];
    if (extracted.normalized.length > 0) {
      const persisted = await this.persistPendingLogs(tenantId, device, extracted.normalized, ctx.source);
      pending = persisted.newLogs;
      counts.duplicate += persisted.duplicates;
    }

    // ── Apply marks ──────────────────────────────────────────────────────────
    if (cfg.autoApply && pending.length > 0) {
      const applied = await this.applyEvents(tenantId, device, pending, cfg);
      counts.applied += applied.applied;
      counts.unmapped += applied.unmapped;
      counts.rejected += applied.rejected;
      counts.error += applied.error;
    }

    if (errorEntries.length > 0) {
      await this.persistErrorLogs(tenantId, device, errorEntries, ctx.source);
      counts.error += errorEntries.length;
    }

    if (extracted.normalized.length > 0 || errorEntries.length > 0) {
      await this.touch(tenantId, device.id);
    }

    await this.audit(tenantId, ctx.actorUserId ?? 'system', AUDIT_ACTIONS.ATTENDANCE_DEVICE_EVENTS_INGESTED, 'AttendanceDevice', device.id, {
      after: { code: device.code, source: ctx.source, ...counts },
    });

    return counts;
  }

  /**
   * Reconciliation: re-process existing log rows whose status permits it (QUEUED/UNMAPPED/
   * REJECTED/ERROR) after sessions opened or mappings were fixed. Manual marks are still
   * preserved, so re-running is idempotent.
   */
  async reprocess(tenantId: string, opts: { deviceId?: string; from?: Date | null; to?: Date | null }): Promise<IngestedEventCounts> {
    const where: Prisma.AttendanceDeviceLogWhereInput = {
      tenantId,
      status: { in: PROCESSABLE_LOG_STATUSES },
    };
    if (opts.deviceId) where.deviceId = opts.deviceId;
    if (opts.from || opts.to) {
      where.capturedAt = { gte: opts.from ?? undefined, lte: opts.to ?? undefined };
    }

    const logs = await this.client.attendanceDeviceLog.findMany({
      where,
      orderBy: { capturedAt: 'asc' },
      take: 2000,
      include: { device: { select: { id: true, code: true, status: true, deviceType: true } } },
    });

    const counts: IngestedEventCounts = { ...EMPTY_COUNTS, received: logs.length };

    const byDevice = new Map<string, { device: { id: string; code: string; deviceType: string; status: string }; rows: PendingLog[] }>();
    for (const log of logs) {
      const device = { id: log.device.id, code: log.device.code, deviceType: log.device.deviceType, status: log.device.status };
      if (!byDevice.has(log.deviceId)) byDevice.set(log.deviceId, { device, rows: [] });
      byDevice.get(log.deviceId)!.rows.push({
        log: { id: log.id, eventType: log.eventType, externalPersonId: log.externalPersonId, capturedAt: log.capturedAt },
        event: {
          externalPersonId: log.externalPersonId,
          capturedAt: log.capturedAt,
          eventType: (log.eventType as NormalizedDeviceEvent['eventType']) ?? 'SCAN',
        },
      });
    }

    const cfg = await this.deviceRules(tenantId);
    for (const { device, rows } of byDevice.values()) {
      if (!cfg.autoApply) continue;
      if (device.status !== 'ACTIVE') continue;
      try {
        const applied = await this.applyEvents(tenantId, device, rows, cfg);
        counts.applied += applied.applied;
        counts.unmapped += applied.unmapped;
        counts.rejected += applied.rejected;
        counts.error += applied.error;
      } catch (error) {
        this.logger.error(`Reconciliation apply failed for ${device.code}: ${error instanceof Error ? error.message : error}`);
        counts.error += rows.length;
        for (const row of rows) {
          await this.client.attendanceDeviceLog.update({
            where: { id: row.log.id },
            data: { status: 'ERROR', processingNote: 'Reconciliation apply failed.', processedAt: new Date() },
          });
        }
      }
    }

    await this.audit(tenantId, 'system', AUDIT_ACTIONS.ATTENDANCE_DEVICE_LOG_PROCESSED, 'AttendanceDeviceLog', tenantId, {
      after: { scope: 'reconcile', ...counts },
    });

    return counts;
  }

  // ── Normalize ────────────────────────────────────────────────────────────

  private extractEvents(
    payload?: unknown,
    rows?: DeviceEventRowDto[],
  ): { normalized: NormalizedDeviceEvent[]; rejected: Array<{ raw: any; reason: string }> } {
    const rejected: Array<{ raw: any; reason: string }> = [];

    if (rows && rows.length > 0) {
      const normalized: NormalizedDeviceEvent[] = [];
      for (const row of rows) {
        const personId = normalizeExternalPersonId(row.externalPersonId);
        const capturedAt = new Date(row.capturedAt);
        if (!personId || Number.isNaN(capturedAt.getTime())) {
          rejected.push({ raw: row, reason: 'Row missing a valid personId/capturedAt.' });
          continue;
        }
        normalized.push({ externalPersonId: personId, capturedAt, eventType: row.eventType as NormalizedDeviceEvent['eventType'] });
      }
      return { normalized, rejected };
    }

    const result = normalizeDeviceEvent(payload, 'generic');
    return { normalized: result.events, rejected: result.rejected.map((r) => ({ raw: payload, reason: r.reason })) };
  }

  // ── Persist ──────────────────────────────────────────────────────────────

  /** Creates QUEUED AttendanceDeviceLog rows for unseen events; known keys count as duplicates. */
  private async persistPendingLogs(
    tenantId: string,
    device: { id: string },
    events: NormalizedDeviceEvent[],
    source: DeviceIngestSource,
  ): Promise<{ newLogs: PendingLog[]; duplicates: number }> {
    const keyed = events.map((e) => ({
      event: e,
      key:
        e.externalPersonId && e.capturedAt
          ? buildDeviceDedupeKey({ deviceId: device.id, externalPersonId: e.externalPersonId, eventType: e.eventType, capturedAt: e.capturedAt })
          : null,
    }));

    const keys = keyed.map((k) => k.key).filter((k): k is string => k !== null);
    const existing = keys.length
      ? await this.client.attendanceDeviceLog.findMany({ where: { tenantId, dedupeKey: { in: keys } }, select: { dedupeKey: true } })
      : [];
    const seen = new Set(existing.map((e) => e.dedupeKey));

    const newLogs: PendingLog[] = [];
    let duplicates = 0;

    for (const { event, key } of keyed) {
      if (key && seen.has(key)) {
        duplicates += 1;
        continue;
      }
      const log = await this.client.attendanceDeviceLog.create({
        data: {
          tenantId,
          deviceId: device.id,
          eventType: event.eventType,
          externalPersonId: event.externalPersonId,
          capturedAt: event.capturedAt ?? new Date(),
          ingestSource: source,
          dedupeKey: key,
          rawPayload: { person: event.externalPersonId, capturedAt: event.capturedAt?.toISOString(), eventType: event.eventType },
          status: 'QUEUED',
        },
      });
      newLogs.push({ log, event });
    }

    return { newLogs, duplicates };
  }

  private async persistErrorLogs(
    tenantId: string,
    device: { id: string },
    errors: Array<{ raw: any; note: string }>,
    source: DeviceIngestSource,
  ): Promise<void> {
    for (const err of errors) {
      await this.client.attendanceDeviceLog.create({
        data: {
          tenantId,
          deviceId: device.id,
          eventType: 'SCAN',
          externalPersonId: null,
          capturedAt: new Date(),
          ingestSource: source,
          dedupeKey: null,
          rawPayload: { source: 'normalizer', note: err.note, payload: err.raw },
          status: 'ERROR',
          processingNote: err.note,
        },
      });
    }
  }

  private async touch(tenantId: string, deviceId: string): Promise<void> {
    try {
      await this.client.attendanceDevice.updateMany({
        where: { id: deviceId, tenantId },
        data: { lastSeenAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(`Failed to touch device ${deviceId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────

  /** Resolves mappings and applies DEVICE marks per pending log (never throws per row). */
  private async applyEvents(
    tenantId: string,
    device: { id: string; code: string },
    pending: PendingLog[],
    cfg: DeviceRules,
  ): Promise<Pick<IngestedEventCounts, 'applied' | 'unmapped' | 'rejected' | 'error'>> {
    const counts = { applied: 0, unmapped: 0, rejected: 0, error: 0 };
    if (pending.length === 0) return counts;

    const mappingIndex = await this.mappingIndex(tenantId, device.id, pending);
    const studentRows: Array<{ row: PendingLog; studentId: string }> = [];
    const userRows: Array<{ row: PendingLog; userId: string }> = [];
    const unmapped: PendingLog[] = [];

    for (const row of pending) {
      const map = mappingIndex.get(row.event.externalPersonId ?? '');
      if (!map) {
        unmapped.push(row);
      } else if (map.mappedType === 'STUDENT' && map.studentId) {
        studentRows.push({ row, studentId: map.studentId });
      } else if (map.mappedType === 'USER' && map.userId) {
        userRows.push({ row, userId: map.userId });
      } else {
        unmapped.push(row);
      }
    }

    // Unmapped — could not resolve a person; kept UNMAPPED for reconciliation.
    for (const row of unmapped) {
      await this.client.attendanceDeviceLog.update({
        where: { id: row.log.id },
        data: { status: 'UNMAPPED', processingNote: 'No active device person mapping found.', processedAt: new Date() },
      });
      counts.unmapped += 1;
    }

    const studentResult = await this.applyStudentMarks(tenantId, device, studentRows, cfg);
    counts.applied += studentResult.applied;
    counts.rejected += studentResult.noSession;
    counts.error += studentResult.error;

    const userResult = await this.applyUserMarks(tenantId, device, userRows);
    counts.applied += userResult.applied;
    counts.error += userResult.error;

    return counts;
  }

  private async applyStudentMarks(
    tenantId: string,
    device: { id: string; code: string },
    rows: Array<{ row: PendingLog; studentId: string }>,
    cfg: DeviceRules,
  ): Promise<{ applied: number; noSession: number; error: number }> {
    if (rows.length === 0) return { applied: 0, noSession: 0, error: 0 };

    let applied = 0;
    let noSession = 0;
    let error = 0;

    // Bucket student rows by UTC day so the same-day session lookups are shared.
    const byDay = new Map<string, Array<{ row: PendingLog; studentId: string }>>();
    for (const entry of rows) {
      const day = startOfUtcDay(entry.row.event.capturedAt ?? new Date()).toISOString();
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(entry);
    }

    const opBatches: Prisma.PrismaPromise<any>[][] = [];
    const logUpdates: Array<{
      id: string;
      studentId?: string;
      sessionId?: string | null;
      appliedRecordId?: string | null;
      status: string;
      note: string;
    }> = [];

    for (const [dayIso, dayRows] of byDay) {
      const day = new Date(dayIso);
      const sessions = await this.client.attendanceSession.findMany({
        where: {
          tenantId,
          status: AttendanceSessionStatus.OPEN,
          deletedAt: null,
          date: { gte: day, lte: addUtc(day, 1) },
        },
        select: {
          id: true,
          date: true,
          courseOfferingId: true,
          sectionId: true,
          startTime: true,
          endTime: true,
          attendanceType: true,
          termId: true,
          subjectCode: true,
          subjectName: true,
        },
      });

      if (sessions.length === 0) {
        for (const entry of dayRows) {
          noSession += 1;
          logUpdates.push({
            id: entry.row.log.id,
            status: 'REJECTED',
            note: `No open attendance session on ${dayIso.slice(0, 10)}.`,
          });
        }
        continue;
      }

      const offeringIds = [...new Set(sessions.map((s) => s.courseOfferingId).filter((x): x is string => x !== null))];
      const sectionIds = [...new Set(sessions.map((s) => s.sectionId).filter((x): x is string => x !== null))];
      const studentIds = [...new Set(dayRows.map((e) => e.studentId))];

      // Batch roster lookups for the whole day: which of these students is on which session.
      const [registrations, enrollments] = await Promise.all([
        offeringIds.length > 0 && studentIds.length > 0
          ? this.client.courseRegistration.findMany({
              where: { tenantId, studentId: { in: studentIds }, courseOfferingId: { in: offeringIds }, status: { in: ROSTER_STATUSES } },
              select: { courseOfferingId: true, studentId: true },
            })
          : ([] as Array<{ courseOfferingId: string; studentId: string }>),
        sectionIds.length > 0 && studentIds.length > 0
          ? this.client.studentEnrollment.findMany({
              where: { tenantId, studentId: { in: studentIds }, sectionId: { in: sectionIds }, status: 'ACTIVE' },
              select: { sectionId: true, studentId: true },
            })
          : ([] as Array<{ sectionId: string; studentId: string }>),
      ]);

      const offeringMembership = new Set(registrations.map((r) => `${r.studentId}|${r.courseOfferingId}`));
      const sectionMembership = new Set(enrollments.map((r) => `${r.studentId}|${r.sectionId}`));
      const eligibleFor = (studentId: string, session: { courseOfferingId: string | null; sectionId: string | null }): boolean => {
        if (session.courseOfferingId && offeringMembership.has(`${studentId}|${session.courseOfferingId}`)) return true;
        if (session.sectionId && sectionMembership.has(`${studentId}|${session.sectionId}`)) return true;
        return false;
      };

      // Fetch existing marks for (studentId × daySessions) once, to preserve MANUAL rows.
      const existing = studentIds.length
        ? await this.client.studentAttendance.findMany({
            where: { tenantId, sessionId: { in: sessions.map((s) => s.id) }, studentId: { in: studentIds } },
            select: { id: true, sessionId: true, studentId: true, markMethod: true, status: true },
          })
        : [];
      const existingByKey = new Map(existing.map((r) => [`${r.studentId}|${r.sessionId}`, r]));

      const batch: Prisma.PrismaPromise<any>[] = [];
      for (const entry of dayRows) {
        const candidates = sessions.filter((s) => eligibleFor(entry.studentId, s));
        if (candidates.length === 0) {
          noSession += 1;
          logUpdates.push({
            id: entry.row.log.id,
            status: 'REJECTED',
            note: 'No matching open class for this student on that day.',
          });
          continue;
        }
        const session = pickOpenSession(candidates, entry.row.event.capturedAt ?? new Date());
        const existingMark = existingByKey.get(`${entry.studentId}|${session.id}`);

        if (existingMark && existingMark.markMethod === MANUAL_MARK_METHOD) {
          applied += 1;
          logUpdates.push({
            id: entry.row.log.id,
            studentId: entry.studentId,
            sessionId: session.id,
            appliedRecordId: existingMark.id,
            status: 'APPLIED',
            note: 'Manual mark preserved; device event recorded.',
          });
          continue;
        }

        const status = deriveMarkStatus(session, entry.row.event.capturedAt ?? new Date(), cfg.gracePeriodMinutes);
        batch.push(
          this.client.studentAttendance.upsert({
            where: { tenantId_sessionId_studentId: { tenantId, sessionId: session.id, studentId: entry.studentId } },
            create: {
              tenantId,
              studentId: entry.studentId,
              sessionId: session.id,
              date: session.date,
              attendanceType: session.attendanceType,
              termId: session.termId,
              subjectCode: session.subjectCode,
              subjectName: session.subjectName,
              status,
              markMethod: DEVICE_MARK_METHOD,
              signInAt: entry.row.event.capturedAt ?? undefined,
              remarks: `Captured by ${device.code} (${entry.row.event.eventType})`,
            },
            update: {
              status,
              markMethod: DEVICE_MARK_METHOD,
              signInAt: entry.row.event.capturedAt ?? undefined,
              remarks: `Captured by ${device.code} (${entry.row.event.eventType})`,
            },
          }),
        );
        logUpdates.push({
          id: entry.row.log.id,
          studentId: entry.studentId,
          sessionId: session.id,
          status: 'APPLIED',
          note: `Marked ${status} in session ${session.id.slice(0, 8)}.`,
        });
        applied += 1;
      }
      opBatches.push(batch);
    }

    // Run upserts, then back-fill the produced record ids onto the APPLIED logs.
    const recordIdByKey = new Map<string, string>();
    for (const batch of opBatches) {
      if (batch.length === 0) continue;
      const records = await this.client.$transaction(batch);
      for (const rec of records) {
        recordIdByKey.set(`${rec.studentId}|${rec.sessionId}`, rec.id);
      }
    }

    for (const update of logUpdates) {
      const recordId = update.sessionId && update.studentId ? recordIdByKey.get(`${update.studentId}|${update.sessionId}`) : null;
      await this.client.attendanceDeviceLog.update({
        where: { id: update.id },
        data: {
          status: update.status,
          sessionId: update.sessionId ?? null,
          appliedRecordId: update.appliedRecordId ?? recordId ?? null,
          processingNote: update.note,
          processedAt: new Date(),
        },
      });
    }

    return { applied, noSession, error };
  }

  private async applyUserMarks(
    tenantId: string,
    device: { id: string; code: string },
    rows: Array<{ row: PendingLog; userId: string }>,
  ): Promise<{ applied: number; error: number }> {
    if (rows.length === 0) return { applied: 0, error: 0 };

    const ops: Prisma.PrismaPromise<any>[] = [];
    const logUpdates: Array<{ id: string; status: string; note: string }> = [];
    let applied = 0;

    for (const entry of rows) {
      const day = startOfUtcDay(entry.row.event.capturedAt ?? new Date());
      const isOut = entry.row.event.eventType === 'OUT';
      ops.push(
        this.client.facultyAttendance.upsert({
          where: { tenantId_userId_date: { tenantId, userId: entry.userId, date: day } },
          create: {
            tenantId,
            userId: entry.userId,
            date: day,
            status: AttendanceStatus.PRESENT,
            checkInAt: isOut ? null : (entry.row.event.capturedAt ?? null),
            checkOutAt: isOut ? (entry.row.event.capturedAt ?? null) : null,
            markMethod: DEVICE_MARK_METHOD,
            remarks: `Captured by ${device.code} (${entry.row.event.eventType})`,
          },
          update: {
            status: AttendanceStatus.PRESENT,
            markMethod: DEVICE_MARK_METHOD,
            checkInAt: isOut ? undefined : (entry.row.event.capturedAt ?? undefined),
            checkOutAt: isOut ? (entry.row.event.capturedAt ?? undefined) : undefined,
            remarks: `Captured by ${device.code} (${entry.row.event.eventType})`,
          },
        }),
      );
      logUpdates.push({ id: entry.row.log.id, status: 'APPLIED', note: isOut ? 'Staff check-out recorded.' : 'Staff check-in recorded.' });
      applied += 1;
    }

    await this.client.$transaction(ops);
    for (const update of logUpdates) {
      await this.client.attendanceDeviceLog.update({
        where: { id: update.id },
        data: { status: update.status, processingNote: update.note, processedAt: new Date() },
      });
    }
    return { applied, error: 0 };
  }

  /** Indexes active mappings for a device by externalPersonId (one query per apply batch). */
  private async mappingIndex(
    tenantId: string,
    deviceId: string,
    pending: Array<{ event: NormalizedDeviceEvent }>,
  ): Promise<Map<string, { mappedType: string; studentId: string | null; userId: string | null }>> {
    const personIds = [...new Set(pending.map((p) => p.event.externalPersonId).filter((x): x is string => x !== null))];
    const rows = personIds.length
      ? await this.client.attendanceDeviceUser.findMany({
          where: { tenantId, deviceId, externalPersonId: { in: personIds }, isActive: true },
          select: { externalPersonId: true, mappedType: true, studentId: true, userId: true },
        })
      : [];
    return new Map(rows.map((r) => [r.externalPersonId, { mappedType: r.mappedType, studentId: r.studentId, userId: r.userId }]));
  }

  private async audit(
    tenantId: string,
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    payload: { before?: unknown; after?: unknown },
  ): Promise<void> {
    const isSystem = !actorUserId || actorUserId === 'system';
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: isSystem ? 'SYSTEM' : 'USER',
      actorUserId: isSystem ? undefined : actorUserId,
      action,
      module: 'attendance',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }
}

// ── Pure date / session helpers ───────────────────────────────────────────

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(hhmm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function deriveMarkStatus(
  session: { startTime?: string | null; endTime?: string | null },
  capturedAt: Date,
  gracePeriodMinutes: number,
): AttendanceStatus {
  const end = toMinutes(session.endTime ?? null);
  if (end !== null) {
    const captured = capturedAt.getUTCHours() * 60 + capturedAt.getUTCMinutes();
    if (captured > end + gracePeriodMinutes) return AttendanceStatus.LATE;
  }
  return AttendanceStatus.PRESENT;
}

/** Picks the best matching open session for a captured time — the one containing the mark, else
 * the earliest that starts on/after it, else the earliest. Deterministic. */
function pickOpenSession<T extends { id: string; startTime?: string | null; endTime?: string | null }>(
  candidates: T[],
  capturedAt: Date,
): T {
  const captured = capturedAt.getUTCHours() * 60 + capturedAt.getUTCMinutes();
  const containing = candidates.find((c) => {
    const start = toMinutes(c.startTime ?? null);
    const end = toMinutes(c.endTime ?? null);
    if (start === null || end === null) return false;
    return captured >= start && captured <= end;
  });
  if (containing) return containing;
  const sorted = [...candidates].sort((a, b) => (toMinutes(a.startTime ?? null) ?? 0) - (toMinutes(b.startTime ?? null) ?? 0));
  return sorted[0]!;
}