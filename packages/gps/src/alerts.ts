import type { GpsAlertSpec, GpsPosition, GpsCoordinate } from './types';

/**
 * A ready-to-evaluate route context: the vehicle's planned stops (with reach radii) and a speed
 * cap. Pure helpers here so both the API ingest path and the worker's polling sweep evaluate
 * identically, and so the logic is unit-testable without a database.
 */
export interface GpsAlertContext {
  /** Ordered waypoints of the active (or nearest) trip's route. */
  stops?: Array<{
    latitude: number;
    longitude: number;
    reachRadiusMeters: number;
  }>;
  maxSpeedKmh?: number;
  /** How far (meters) a position may drift from the nearest planned stop before OFF_ROUTE fires. */
  maxOffRouteMeters?: number;
}

/** Great-circle distance in meters between two coordinates (Haversine). */
export function haversineDistanceMeters(a: GpsCoordinate, b: GpsCoordinate): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the given position is within reach of the stop's geofence. */
export function isPositionNearStop(
  position: GpsCoordinate,
  stop: GpsCoordinate,
  reachRadiusMeters: number,
): boolean {
  return haversineDistanceMeters(position, stop) <= reachRadiusMeters;
}

/**
 * Evaluates a live fix against the trip context and emits the alerts the pipeline should persist.
 * One fix may legitimately produce several alerts (e.g. speeding while off route). Excursion
 * detection is a simple nearest-stop distance check — adequate for single-route school runs.
 */
export function evaluatePositionAlerts(
  position: GpsPosition,
  context: GpsAlertContext,
): GpsAlertSpec[] {
  const alerts: GpsAlertSpec[] = [];

  const maxSpeedKmh = context.maxSpeedKmh;
  if (maxSpeedKmh != null && position.speedKmh != null && position.speedKmh > maxSpeedKmh) {
    alerts.push({
      type: 'SPEEDING',
      severity: position.speedKmh > maxSpeedKmh * 1.25 ? 'CRITICAL' : 'WARNING',
      title: 'Speed limit exceeded',
      message: `Vehicle travelling at ${position.speedKmh.toFixed(1)} km/h (limit ${maxSpeedKmh} km/h).`,
    });
  }

  const stops = context.stops ?? [];
  if (stops.length > 0) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const stop of stops) {
      const d = haversineDistanceMeters(position, stop);
      if (d < nearest) {
        nearest = d;
      }
    }
    const limit = context.maxOffRouteMeters ?? 1000;
    if (nearest > limit) {
      alerts.push({
        type: 'OFF_ROUTE',
        severity: 'WARNING',
        title: 'Vehicle off route',
        message: `Vehicle is ${Math.round(nearest)} m from its nearest planned stop.`,
      });
    }
  }

  return alerts;
}