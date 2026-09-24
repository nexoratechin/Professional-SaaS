import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYSTEM_ROLE_CODES } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import {
  MockGpsProvider,
  TransportGpsProviderRegistry,
  evaluatePositionAlerts,
  type GpsPosition,
} from '@college-erp/gps';
import { QUEUE_NAMES, type TransportGpsSweepJobData } from '@college-erp/types';

/**
 * Periodic GPS polling sweep â€” finds every tenant whose TransportGpsConfig has polling enabled,
 * polls its fitted vehicles through the tenant's provider adapter (transport_gps_configs.provider;
 * resolved from the packages/gps registry, mock by default), persists fixes, evaluates them against
 * the active trip's route (speed cap, planned-stop geofence) and raises transport_alerts + fan-outs
 * CRITICAL alerts to transport-manager users as notifications.
 *
 * Like the other maintenance sweeps this READS tenant config through the unscoped platform client
 * (it can't know which tenants to visit otherwise) but performs every mutation through a
 * tenant-scoped client built per tenant.
 */
@Processor(QUEUE_NAMES.TRANSPORT_GPS_SWEEP)
export class TransportGpsSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(TransportGpsSweepProcessor.name);
  private readonly registry = new TransportGpsProviderRegistry(new MockGpsProvider());

  async process(_job: Job<TransportGpsSweepJobData>): Promise<void> {
    const enabled = await platformPrismaClient.transportGpsConfig.findMany({
      where: { pollEnabled: true, enabled: true },
      select: {
        tenantId: true,
        provider: true,
        pollIntervalSeconds: true,
        settings: true,
        lastPolledAt: true,
      },
    });

    let positionsWritten = 0;
    let alertsRaised = 0;

    for (const config of enabled) {
      const tenantClient = createTenantScopedClient(config.tenantId);
      const provider = this.registry.resolve(config.provider);

      const vehicles = await tenantClient.transportVehicle.findMany({
        where: { gpsDeviceId: { not: null }, deletedAt: null },
        select: { id: true, gpsDeviceId: true },
      });
      if (vehicles.length === 0) {
        continue;
      }

      const deviceIds = vehicles.map((v) => v.gpsDeviceId as string);
      const since = config.lastPolledAt ?? new Date(Date.now() - config.pollIntervalSeconds * 1000);
      const feed = await provider.poll(deviceIds, since, { settings: (config.settings ?? {}) as Record<string, unknown> });

      for (const { id: vehicleId, gpsDeviceId } of vehicles) {
        const fixes = feed[gpsDeviceId as string];
        if (!fixes || fixes.length === 0) {
          continue;
        }

        const trip = await tenantClient.transportTrip.findFirst({
          where: { vehicleId, status: 'ONGOING' },
        });

        for (const position of fixes) {
          await tenantClient.transportGPSPosition.create({
            data: {
              tenantId: config.tenantId,
              vehicleId,
              tripId: trip?.id,
              latitude: position.latitude,
              longitude: position.longitude,
              speedKmh: position.speedKmh,
              heading: position.heading,
              accuracyMeters: position.accuracyMeters,
              recordedAt: position.recordedAt,
              source: provider.name,
              rawData: position.raw as Record<string, unknown> | undefined,
            },
          });
          positionsWritten += 1;

          if (trip) {
            alertsRaised += await this.evaluateTripFix(tenantClient, config.tenantId, vehicleId, trip.id, position);
          }
        }
      }

      await platformPrismaClient.transportGpsConfig.update({
        where: { tenantId: config.tenantId },
        data: { lastPolledAt: new Date() },
      });
    }

    this.logger.log(
      `Transport GPS sweep: visited ${enabled.length} tenant(s), wrote ${positionsWritten} fix(es), raised ${alertsRaised} alert(s).`,
    );
  }

  private async evaluateTripFix(
    tenantClient: ReturnType<typeof createTenantScopedClient>,
    tenantId: string,
    vehicleId: string,
    tripId: string,
    position: GpsPosition,
  ): Promise<number> {
    const trip = await tenantClient.transportTrip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        route: { include: { stops: { orderBy: { order: 'asc' } } } },
      },
    });

    const stops = trip.route.stops
      .filter((stop) => stop.latitude != null && stop.longitude != null && stop.isActive)
      .map((stop) => ({
        latitude: stop.latitude as number,
        longitude: stop.longitude as number,
        reachRadiusMeters: stop.reachRadiusMeters,
      }));

    const specs = evaluatePositionAlerts(position, {
      stops,
      maxSpeedKmh: 40,
      maxOffRouteMeters: 1000,
    });

    let raised = 0;
    for (const spec of specs) {
      const duplicate = await tenantClient.transportAlert.findFirst({
        where: {
          vehicleId,
          type: spec.type,
          resolvedAt: null,
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
      });
      if (duplicate) {
        continue;
      }

      const alert = await tenantClient.transportAlert.create({
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

      raised += 1;

      if (spec.severity === 'CRITICAL') {
        const managers = await tenantClient.userRole.findMany({
          where: { role: { code: SYSTEM_ROLE_CODES.TRANSPORT_MANAGER }, user: { status: 'ACTIVE' } },
          select: { user: { select: { id: true } } },
        });
        for (const { user } of managers) {
          await tenantClient.notification.create({
            data: {
              tenantId,
              recipientUserId: user.id,
              channel: 'IN_APP',
              subject: `${alert.severity} transport alert: ${alert.title}`,
              body: `${alert.message} (${alert.type})`,
            },
          });
        }
      }
    }

    return raised;
  }
}