/**
 * Provider-agnostic GPS integration contract shared by apps/api (ingest + on-demand poll, GPS
 * registry) and apps/worker (scheduled polling sweep). Adding a real tracking vendor is just an
 * adapter class implementing TransportGpsProvider and registering it with TransportGpsProviderRegistry
 * — the module's data model, API surface and alert pipeline never change.
 */

export interface GpsCoordinate {
  latitude: number;
  longitude: number;
}

export interface GpsPosition extends GpsCoordinate {
  /** Ground speed in km/h, when the feed provides it. */
  speedKmh?: number;
  /** Compass heading in degrees (0-359). */
  heading?: number;
  /** Position accuracy in meters, when the feed provides it. */
  accuracyMeters?: number;
  /** When the fix was captured by the device/feed. */
  recordedAt: Date;
  /** Raw feed payload, preserved for debugging. */
  raw?: Record<string, unknown>;
}

/** Provider-specific opaque settings (api keys, feed URLs, vehicle mappings, …). */
export interface TransportGpsProviderConfig {
  settings: Record<string, unknown>;
}

/** One suggested alert from the evaluator — the caller owns persisting it. */
export interface GpsAlertSpec {
  type: 'SPEEDING' | 'OFF_ROUTE' | 'GEOFENCE_EXIT' | 'GEOFENCE_ENTER' | 'UNPLANNED_STOP' | 'DELAYED';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
}

export interface TransportGpsProvider {
  readonly name: string;
  /**
   * Fetch the latest positions for the given vehicles (keyed by their gpsDeviceId). `since` tells
   * the feed which fixes the caller already has so it only returns new ones. Returns a map from
   * deviceId → new fixes since `since`.
   */
  poll(
    deviceIds: string[],
    since: Date,
    config: TransportGpsProviderConfig,
  ): Promise<Record<string, GpsPosition[]>>;
}

/** Dispatch lookup for a registered provider by name; falls back to the mock provider. */
export class TransportGpsProviderRegistry {
  private readonly providers = new Map<string, TransportGpsProvider>();

  constructor(private readonly fallback: TransportGpsProvider) {
    this.register(fallback);
  }

  register(provider: TransportGpsProvider): void {
    this.providers.set(provider.name, provider);
  }

  resolve(name: string): TransportGpsProvider {
    return this.providers.get(name) ?? this.fallback;
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}