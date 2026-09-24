/**
 * Transport GPS service â€” provider-agnostic tracking surface for the transport module. It owns:
 *  1. the per-tenant TransportGpsConfig (which provider adapter, polling on/off, rate),
 *  2. an on-demand poll (POST /transport/gps/poll) through the packages/gps provider registry,
 *  3. a device/provider push ingest (POST /transport/gps/positions).
 * Both write fixes, link them to any ONGOING trip, evaluate them against the trip route
 * (speed cap + planned-stop geofence) via the shared packages/gps evaluator, persist transport
 * alerts and fan out CRITICAL alerts to transport-manager users. The worker's scheduled sweep
 * (apps/worker) reuses the same registry + evaluator.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, SYSTEM_ROLE_CODES } from '@college-erp/auth';
import {
  MockGpsProvider,
  TransportGpsProviderRegistry,
  evaluatePositionAlerts,
  type GpsPosition,
} from '@college-erp/gps';
import { TenantScopedPrismaService } from '../../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class TransportGpsService {
  private readonly logger = new Logger(TransportGpsService.name);
  private readonly registry = new TransportGpsProviderRegistry(new MockGpsProvider());

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private get db(): any {
    return this.tenantPrisma.client;
  }

  private async audit(
    tenantId: string,
    userId: string | undefined,
    action: string,
    entityType: string,
    entityId: string | undefined,
    extra?: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.TRANSPORT,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  async getConfig(tenantId: string) {
    const existing = await this.db.transportGpsConfig.findUnique({ where: { tenantId } });
    if (existing) return existing;
    return {
      id: null,
      tenantId,
      provider: 'mock',
      enabled: false,
      pollEnabled: false,
      pollIntervalSeconds: 30,
      settings: null,
      lastPolledAt: null,
    };
  }

  async updateConfig(tenantId: string, userId: string, dto: any) {
    const before = await this.getConfig(tenantId);
    const row = await this.db.transportGpsConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: dto.provider ?? 'mock',
        enabled: dto.enabled ?? false,
        pollEnabled: dto.pollEnabled ?? false,
        pollIntervalSeconds: dto.pollIntervalSeconds ?? 30,
        settings: dto.settings ?? null,
        createdBy: userId,
      },
      update: {
        ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.pollEnabled !== undefined ? { pollEnabled: dto.pollEnabled } : {}),
        ...(dto.pollIntervalSeconds !== undefined ? { pollIntervalSeconds: dto.pollIntervalSeconds } : {}),
        ...(dto.settings !== undefined ? { settings: dto.settings } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_GPS_CONFIG_UPDATED, 'TransportGpsConfig', row.id, {
      before: before.id ? before : undefined,
      after: row,
    });
    return row;
  }

  /** On-demand poll of the tenant's fitted vehicles through the configured provider adapter. */
  async pollNow(tenantId: string, userId: string) {
    const config = await this.getConfig(tenantId);
    if (!config.enabled) {
      throw new BadRequestException('GPS tracking is disabled for this tenant.');
    }
    const vehicles = await this.db.transportVehicle.findMany({
      where: { gpsDeviceId: { not: null }, deletedAt: null },
      select: { id: true, gpsDeviceId: true },
    });
    if (vehicles.length === 0) {
      return { written: 0, providers: this.registry.names() };
    }

    const provider = this.registry.resolve(config.provider);
    const since = config.lastPolledAt ?? new Date(Date.now() - config.pollIntervalSeconds * 1000);
    const feed = await provider.poll(
      vehicles.map((v: any) => v.gpsDeviceId as string),
      since,
      { settings: (config.settings ?? {}) as Record<string, unknown> },
    );

    let written = 0;
    for (const vehicle of vehicles) {
      const fixes = feed[(vehicle as { gpsDeviceId: string }).gpsDeviceId as string];
      if (!fixes) continue;
      written += await this.persistAndEvaluate(tenantId, userId, vehicle.id, fixes, provider.name);
    }

    await this.db.transportGpsConfig.update({ where: { tenantId }, data: { lastPolledAt: new Date() } });
    this.logger.log(`transport.gps: on-demand poll for tenant ${tenantId} wrote ${written} fix(es).`);
    return { written, providers: this.registry.names() };
  }

  /** Device/provider webhook ingest â€” the provider-agnostic push path. A row is written per fix. */
  async ingest(tenantId: string, userId: string | undefined, dto: any) {
    const vehicle = await this.db.transportVehicle.findFirst({
      where: { gpsDeviceId: dto.vehicleDeviceId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException('No vehicle found for the given device id.');
    }
    const fixes: GpsPosition[] = dto.positions.map((p: any) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      speedKmh: p.speedKmh,
      heading: p.heading,
      accuracyMeters: p.accuracyMeters,
      recordedAt: p.recordedAt ? new Date(p.recordedAt) : new Date(),
      raw: { source: p.source ?? 'device' },
    }));
    const written = await this.persistAndEvaluate(tenantId, userId, vehicle.id, fixes, dto.vehicleDeviceId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_GPS_POSITIONS_INGESTED, 'TransportGPSPosition', undefined, {
      after: { vehicleId: vehicle.id, written },
    });
    return { written };
  }

  /** Shared pipeline: write fixes, link ONGOING trips, evaluate + raise alerts, notify CRITICAL. */
  private async persistAndEvaluate(
    tenantId: string,
    userId: string | undefined,
    vehicleId: string,
    fixes: GpsPosition[],
    source: string,
  ): Promise<number> {
    const trip = await this.db.transportTrip.findFirst({
      where: { vehicleId, status: 'ONGOING' },
      select: { id: true },
    });

    let written = 0;
    for (const position of fixes) {
      await this.db.transportGPSPosition.create({
        data: {
          tenantId,
          vehicleId,
          tripId: trip?.id,
          latitude: position.latitude,
          longitude: position.longitude,
          speedKmh: position.speedKmh,
          heading: position.heading,
          accuracyMeters: position.accuracyMeters,
          recordedAt: position.recordedAt,
          source,
          rawData: position.raw as Record<string, unknown> | undefined,
        },
      });
      written += 1;
      if (trip) {
        await this.evaluateAndRaise(tenantId, userId, vehicleId, trip.id, position);
      }
    }
    return written;
  }

  private async evaluateAndRaise(
    tenantId: string,
    userId: string | undefined,
    vehicleId: string,
    tripId: string,
    position: GpsPosition,
  ): Promise<void> {
    const trip = await this.db.transportTrip.findUniqueOrThrow({
      where: { id: tripId },
      include: { route: { include: { stops: { orderBy: { order: 'asc' } } } } },
    });
    const stops = (trip.route.stops as Array<any>)
      .filter((stop) => stop.latitude != null && stop.longitude != null && stop.isActive)
      .map((stop) => ({
        latitude: stop.latitude,
        longitude: stop.longitude,
        reachRadiusMeters: stop.reachRadiusMeters,
      }));

    const specs = evaluatePositionAlerts(position, { stops, maxSpeedKmh: 40, maxOffRouteMeters: 1000 });
    for (const spec of specs) {
      const duplicate = await this.db.transportAlert.findFirst({
        where: {
          vehicleId,
          type: spec.type,
          resolvedAt: null,
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
      });
      if (duplicate) continue;

      const alert = await this.db.transportAlert.create({
        data: {
          tenantId,
          vehicleId,
          tripId,
          type: spec.type,
          severity: spec.severity,
          title: spec.title,
          message: spec.message,
          latitude: position.latitude,
          longitude: position.longitude,
          meta: { speedKmh: position.speedKmh, recordedAt: position.recordedAt },
        },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.TRANSPORT_ALERT_CREATED, 'TransportAlert', alert.id, { after: alert });

      if (spec.severity === 'CRITICAL') {
        await this.notifyTransportManagers(tenantId, alert.title, `${alert.message} (${alert.type})`);
      }
    }
  }

  private async notifyTransportManagers(tenantId: string, subject: string, body: string) {
    const managers = await this.db.userRole.findMany({
      where: { role: { code: SYSTEM_ROLE_CODES.TRANSPORT_MANAGER }, user: { status: 'ACTIVE' } },
      select: { user: { select: { id: true } } },
    });
    for (const { user } of managers) {
      await this.notifications.sendSystem(tenantId, { recipientUserId: user.id, subject, body });
    }
  }
}