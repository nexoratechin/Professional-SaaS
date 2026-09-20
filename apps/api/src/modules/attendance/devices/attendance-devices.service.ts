/**
 * Attendance device service — device registry CRUD, device↔person mappings, the normalized device
 * event log, pull synchronization and reconciliation. The heavy ingest pipeline lives in
 * DeviceIngestService; this service owns the operation-level orchestration (permission/entitlement
 * aware, audit-trailed, endpoint wiring).
 *
 * Sync = resolve the device's (protocol, vendor) adapter → pull RAW vendor payloads → feed them
 * through the SAME downstream pipeline as pushes (DeviceIngestService.ingest). Reconcile =
 * re-process previously QUEUED/UNMAPPED/REJECTED/ERROR logs after sessions opened or mappings
 * were fixed — idempotent because MANUAL marks are preserved.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../../common/prisma/tenant-scoped-prisma.service';
import { PlatformPrismaService } from '../../../common/prisma/platform-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DeviceSecretCipher } from '../../../common/security/device-secret-cipher';
import { EntitlementsGatewayService } from '../../rbac/entitlements-gateway.service';
import { DeviceIngestService } from './device-ingest.service';
import { deviceAdapterRegistry } from './device-adapters';
import { canonicalizePersistedEvents, normalizeExternalPersonId } from './device-dedupe';
import { deviceEntitlementKey } from './device-entitlement';
import {
  CreateDeviceDto,
  ListDeviceLogsQueryDto,
  ListDevicesQueryDto,
  ReconcileDto,
  SyncDeviceDto,
  UpdateDeviceDto,
  UpsertDeviceMappingDto,
} from '../attendance-device.dto';

type Client = PrismaClient;

@Injectable()
export class AttendanceDevicesService {
  private readonly logger = new Logger(AttendanceDevicesService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
    private readonly deviceSecretCipher: DeviceSecretCipher,
    private readonly entitlements: EntitlementsGatewayService,
    private readonly ingestService: DeviceIngestService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  // ── Device registry ──────────────────────────────────────────────────────

  async listDevices(tenantId: string, query: ListDevicesQueryDto) {
    const where: Prisma.AttendanceDeviceWhereInput = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.deviceType) where.deviceType = query.deviceType;

    const [data, total] = await Promise.all([
      this.client.attendanceDevice.findMany({
        where,
        include: {
          room: { select: { id: true, name: true, code: true } },
          _count: { select: { mappings: { where: { isActive: true } }, logs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client.attendanceDevice.count({ where }),
    ]);
    return { data, total };
  }

  async getDevice(tenantId: string, id: string) {
    return this.requireDevice(tenantId, id);
  }

  async createDevice(tenantId: string, actorUserId: string, dto: CreateDeviceDto) {
    const entitlementKey = deviceEntitlementKey(dto.deviceType);
    if (!(await this.entitlements.canUse(tenantId, entitlementKey))) {
      throw new BadRequestException(
        `This tenant is not entitled to ${dto.deviceType.toLowerCase()} attendance capture (requires ${entitlementKey}).`,
      );
    }

    const existing = await this.client.attendanceDevice.findFirst({
      where: { tenantId, code: dto.code.trim(), deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('A device with this code already exists.');

    const device = await this.client.attendanceDevice.create({
      data: {
        tenantId,
        code: dto.code.trim(),
        name: dto.name,
        deviceType: dto.deviceType,
        vendor: dto.vendor ?? 'Generic',
        model: dto.model ?? null,
        protocol: dto.protocol ?? 'HTTP_PUSH',
        ipAddress: dto.ipAddress ?? null,
        port: dto.port ?? null,
        endpointUrl: dto.endpointUrl ?? null,
        serialNumber: dto.serialNumber ?? null,
        location: dto.location ?? null,
        roomId: dto.roomId ?? null,
        authTokenEncrypted: dto.authToken ? this.deviceSecretCipher.encrypt(dto.authToken) : null,
        commKeyEncrypted: dto.commKey ? this.deviceSecretCipher.encrypt(dto.commKey) : null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    });

    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_DEVICE_CREATED, 'AttendanceDevice', device.id, {
      after: { code: device.code, deviceType: device.deviceType, protocol: device.protocol, status: device.status },
    });

    // Secrets are returned exactly once (provisioning); they are only ever stored encrypted.
    return {
      device,
      authTokenOnce: dto.authToken ?? undefined,
      commKeyOnce: dto.commKey ?? undefined,
    };
  }

  async updateDevice(tenantId: string, actorUserId: string, id: string, dto: UpdateDeviceDto) {
    const existing = await this.requireDevice(tenantId, id);
    const nextType = dto.deviceType ?? existing.deviceType;

    const entitlementKey = deviceEntitlementKey(nextType);
    if (!(await this.entitlements.canUse(tenantId, entitlementKey))) {
      throw new BadRequestException(
        `This tenant is not entitled to ${nextType.toLowerCase()} attendance capture (requires ${entitlementKey}).`,
      );
    }

    const hasNewSecret = dto.authToken !== undefined || dto.commKey !== undefined;
    const device = await this.client.attendanceDevice.update({
      where: { id },
      data: {
        name: dto.name,
        deviceType: dto.deviceType,
        vendor: dto.vendor,
        model: dto.model,
        protocol: dto.protocol,
        ipAddress: dto.ipAddress,
        port: dto.port,
        endpointUrl: dto.endpointUrl,
        serialNumber: dto.serialNumber,
        location: dto.location,
        roomId: dto.roomId === undefined ? undefined : dto.roomId,
        status: dto.status,
        authTokenEncrypted:
          dto.authToken !== undefined ? (dto.authToken ? this.deviceSecretCipher.encrypt(dto.authToken) : null) : undefined,
        commKeyEncrypted: dto.commKey !== undefined ? (dto.commKey ? this.deviceSecretCipher.encrypt(dto.commKey) : null) : undefined,
        updatedBy: actorUserId,
      },
    });

    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_DEVICE_UPDATED, 'AttendanceDevice', device.id, {
      before: existing,
      after: { deviceType: device.deviceType, protocol: device.protocol, status: device.status, secretRotated: hasNewSecret },
    });

    return {
      device,
      authTokenOnce: hasNewSecret && dto.authToken ? dto.authToken : undefined,
      commKeyOnce: hasNewSecret && dto.commKey ? dto.commKey : undefined,
    };
  }

  async removeDevice(tenantId: string, actorUserId: string, id: string) {
    const existing = await this.requireDevice(tenantId, id);
    const updated = await this.client.attendanceDevice.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE', updatedBy: actorUserId },
    });
    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_DEVICE_DELETED, 'AttendanceDevice', id, {
      before: existing,
      after: { deletedAt: updated.deletedAt },
    });
    return { removed: true };
  }

  private async requireDevice(tenantId: string, id: string) {
    const device = await this.client.attendanceDevice.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        room: { select: { id: true, name: true, code: true } },
        mappings: {
          where: { isActive: true },
          include: {
            student: { select: { id: true, fullName: true, rollNumber: true, admissionNumber: true } },
            user: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!device) throw new NotFoundException('Attendance device not found.');
    return device;
  }

  // ── Device <-> person mappings ───────────────────────────────────────────

  async listMappings(tenantId: string, deviceId: string) {
    await this.requireDevice(tenantId, deviceId);
    const data = await this.client.attendanceDeviceUser.findMany({
      where: { tenantId, deviceId },
      include: {
        student: { select: { id: true, fullName: true, rollNumber: true, admissionNumber: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { data };
  }

  async upsertMapping(tenantId: string, actorUserId: string, deviceId: string, dto: UpsertDeviceMappingDto) {
    await this.requireDevice(tenantId, deviceId);
    const externalPersonId = normalizeExternalPersonId(dto.externalPersonId);
    if (!externalPersonId) throw new BadRequestException('externalPersonId is required.');

    const person = this.resolveMappingPerson(dto.mappedType, dto.studentId, dto.userId);
    const mapping = await this.client.attendanceDeviceUser.upsert({
      where: { tenantId_deviceId_externalPersonId: { tenantId, deviceId, externalPersonId } },
      create: {
        tenantId,
        deviceId,
        externalPersonId,
        mappedType: person.mappedType,
        studentId: person.mappedType === 'STUDENT' ? person.studentId : null,
        userId: person.mappedType === 'USER' ? person.userId : null,
        label: dto.label ?? null,
        isActive: dto.isActive ?? true,
        createdBy: actorUserId,
      },
      update: {
        mappedType: person.mappedType,
        studentId: person.mappedType === 'STUDENT' ? person.studentId : null,
        userId: person.mappedType === 'USER' ? person.userId : null,
        label: dto.label ?? null,
        isActive: dto.isActive ?? true,
        updatedBy: actorUserId,
      },
    });

    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_DEVICE_MAPPING_UPSERTED, 'AttendanceDeviceUser', mapping.id, {
      after: { deviceId, externalPersonId, mappedType: person.mappedType, studentId: person.studentId, userId: person.userId },
    });
    return mapping;
  }

  async removeMapping(tenantId: string, actorUserId: string, mappingId: string) {
    const mapping = await this.client.attendanceDeviceUser.findFirst({ where: { id: mappingId, tenantId } });
    if (!mapping) throw new NotFoundException('Device mapping not found.');
    await this.client.attendanceDeviceUser.delete({ where: { id: mappingId } });
    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_DEVICE_MAPPING_DELETED, 'AttendanceDeviceUser', mappingId, {
      before: mapping,
    });
    return { removed: true };
  }

  private resolveMappingPerson(
    mappedType: string,
    studentId?: string,
    userId?: string,
  ): { mappedType: 'STUDENT' | 'USER'; studentId: string; userId: string } {
    if (mappedType === 'STUDENT') {
      if (!studentId) throw new BadRequestException('studentId is required for STUDENT mappings.');
      if (userId) throw new BadRequestException('STUDENT mappings cannot carry a userId.');
      return { mappedType: 'STUDENT', studentId, userId: '' };
    }
    if (mappedType === 'USER') {
      if (!userId) throw new BadRequestException('userId is required for USER mappings.');
      if (studentId) throw new BadRequestException('USER mappings cannot carry a studentId.');
      return { mappedType: 'USER', studentId: '', userId };
    }
    throw new BadRequestException('mappedType must be STUDENT or USER.');
  }

  // ── Device event log ─────────────────────────────────────────────────────

  async listLogs(tenantId: string, query: ListDeviceLogsQueryDto) {
    const where: Prisma.AttendanceDeviceLogWhereInput = { tenantId };
    if (query.deviceId) where.deviceId = query.deviceId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.capturedAt = { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined };
    }

    const [data, total] = await Promise.all([
      this.client.attendanceDeviceLog.findMany({
        where,
        include: {
          device: { select: { id: true, code: true, name: true, deviceType: true } },
          student: { select: { id: true, fullName: true, rollNumber: true } },
          user: { select: { id: true, fullName: true, email: true } },
          session: { select: { id: true, title: true, subjectCode: true, subjectName: true, date: true } },
        },
        orderBy: { capturedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client.attendanceDeviceLog.count({ where }),
    ]);
    return { data, total };
  }

  // ── Programmatic / admin ingest (authenticated routes) ───────────────────

  /** Ingests pre-normalized rows (admin UI / server-to-server integrations). */
  async ingestRows(tenantId: string, actorUserId: string, deviceId: string, rows: Array<{ externalPersonId: string; capturedAt: string; eventType: string }>) {
    if (rows.length === 0) throw new BadRequestException('No device events supplied.');
    const device = await this.requireDeviceCard(tenantId, deviceId);
    const counts = await this.ingestService.ingest({
      tenantId,
      device,
      source: 'API',
      rows: rows as any,
      actorUserId,
    });
    return { device: { id: device.id, code: device.code }, counts };
  }

  /** Processes the raw push body of an HMAC/bearer-verified device (public gateway route). The
   * device is located by its code WITHOUT a tenant context (the gateway route is excluded from
   * tenant resolution), so the tenant is derived from the device row itself — the documented
   * platform-prisma exception for a pre-context lookup. */
  async ingestPushByCode(code: string, payload: unknown, opts: { bearerToken?: string | null; signature?: string | null; timestamp?: string | null }) {
    const device = await this.platformPrisma.client.attendanceDevice.findFirst({
      where: { code: code.trim(), deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!device) throw new NotFoundException('Attendance device not found.');
    const tenantId = device.tenantId;
    if (device.status !== 'ACTIVE') throw new BadRequestException('Attendance device is not active.');

    const authToken = device.authTokenEncrypted ? this.deviceSecretCipher.decrypt(device.authTokenEncrypted) : null;
    if (!authToken) {
      throw new BadRequestException('This device has no push token configured.');
    }
    if (opts.bearerToken && !this.deviceSecretCipher.matches(device.authTokenEncrypted, opts.bearerToken)) {
      throw new BadRequestException('Invalid device push token.');
    }

    const cfg = await this.ingestService.deviceRules(tenantId);
    const counts = await this.ingestService.ingest({
      tenantId,
      device: { id: device.id, code: device.code, deviceType: device.deviceType, status: device.status },
      source: 'PUSH',
      payload,
      actorUserId: 'system',
      verifyHmac: opts.signature && opts.timestamp
        ? {
            canonicalBody: canonicalizePersistedEvents(device.code, Array.isArray(payload) ? payload : [payload]),
            signature: opts.signature,
            timestamp: opts.timestamp,
            secret: authToken,
            maxSkewSeconds: cfg.ingestMaxSkewSeconds,
          }
        : null,
    });
    await this.touchSync(tenantId, device.id, { ok: true, message: `Ingested ${counts.received} events` });
    return { device: { id: device.id, code: device.code }, counts };
  }

  // ── Pull synchronization ─────────────────────────────────────────────────

  async syncDevice(tenantId: string, deviceId: string, dto: SyncDeviceDto) {
    const device = await this.requireDeviceCard(tenantId, deviceId);
    const cfg = await this.ingestService.deviceRules(tenantId);
    if (!cfg.deviceSyncEnabled) throw new BadRequestException('Device synchronization is disabled for this tenant.');

    const commKey = device.commKeyEncrypted ? this.deviceSecretCipher.decrypt(device.commKeyEncrypted) : null;
    let pull;
    try {
      pull = await deviceAdapterRegistry.pull({
        protocol: device.protocol,
        vendor: device.vendor,
        endpointUrl: device.endpointUrl,
        ipAddress: device.ipAddress,
        port: device.port,
        commKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown adapter failure.';
      await this.touchSync(tenantId, device.id, { ok: false, message });
      throw new BadRequestException(`Device pull failed: ${message}`);
    }

    const ingestDTO: { from?: Date; to?: Date } = {};
    if (dto.from) ingestDTO.from = new Date(dto.from);
    if (dto.to) ingestDTO.to = new Date(dto.to);

    const counts = await this.ingestService.ingest({
      tenantId,
      device: { id: device.id, code: device.code, deviceType: device.deviceType, status: device.status },
      source: 'PULL',
      payload: pull.rawEvents,
      actorUserId: 'system',
    });

    await this.touchSync(tenantId, device.id, { ok: true, message: `Pulled ${counts.received} events (${counts.applied} applied)` });

    await this.audit(tenantId, 'system', AUDIT_ACTIONS.ATTENDANCE_DEVICE_SYNCED, 'AttendanceDevice', device.id, {
      after: { code: device.code, protocol: device.protocol, vendor: device.vendor, ...ingestDTO, ...counts },
    });

    return { device: { id: device.id, code: device.code }, counts };
  }

  // ── Reconciliation ───────────────────────────────────────────────────────

  async reconcile(tenantId: string, actorUserId: string, dto: ReconcileDto) {
    if (dto.deviceId) await this.requireDeviceCard(tenantId, dto.deviceId);
    const counts = await this.ingestService.reprocess(tenantId, {
      deviceId: dto.deviceId,
      from: dto.from ? new Date(dto.from) : null,
      to: dto.to ? new Date(dto.to) : null,
    });
    await this.audit(tenantId, actorUserId, AUDIT_ACTIONS.ATTENDANCE_RECONCILED, 'AttendanceDeviceLog', dto.deviceId ?? tenantId, {
      after: { ...dto, ...counts },
    });
    return { counts };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async requireDeviceCard(tenantId: string, id: string) {
    const device = await this.client.attendanceDevice.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, code: true, deviceType: true, status: true, protocol: true, vendor: true, endpointUrl: true, ipAddress: true, port: true, authTokenEncrypted: true, commKeyEncrypted: true },
    });
    if (!device) throw new NotFoundException('Attendance device not found.');
    return device;
  }

  private async touchSync(tenantId: string, deviceId: string, result: { ok: boolean; message?: string }) {
    await this.client.attendanceDevice.updateMany({
      where: { id: deviceId, tenantId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: result.ok ? 'OK' : 'ERROR',
        lastSyncMessage: result.message ?? null,
        lastSeenAt: new Date(),
      },
    });
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