import type {
  GpsPosition,
  TransportGpsProvider,
  TransportGpsProviderConfig,
} from './types';

/** Deterministic demo feed: vehicles drift in a small fixed loop around their start point, so
 * route tracking, geofence AND speed alerts actually fire in development without hardware. The
 * loop repeats once per minute and each poll advances the simulation by `pollIntervalSeconds`. */
export class MockGpsProvider implements TransportGpsProvider {
  readonly name = 'mock';

  private readonly simBase = new Map<string, { latitude: number; longitude: number; startedAt: number }>();

  async poll(
    deviceIds: string[],
    since: Date,
    config: TransportGpsProviderConfig,
  ): Promise<Record<string, GpsPosition[]>> {
    const positions: Record<string, GpsPosition[]> = {};
    const now = Date.now();

    for (const deviceId of deviceIds) {
      let sim = this.simBase.get(deviceId);
      if (!sim) {
        sim = {
          latitude: 18.6 + Math.random() * 0.01,
          longitude: 73.7 + Math.random() * 0.01,
          startedAt: now,
        };
        this.simBase.set(deviceId, sim);
      }

      const elapsedMs = now - sim.startedAt;
      const phaseSeconds = (elapsedMs / 1000) % 60;
      const rad = (phaseSeconds / 60) * 2 * Math.PI;
      const radius = 0.0035; // ~400 m loop
      const latitude = sim.latitude + Math.sin(rad) * radius;
      const longitude = sim.longitude + Math.cos(rad) * radius;
      // Busy windows: faster (up to ~58 km/h) around the bottom of the loop, calm elsewhere.
      const speedKmh = 15 + 43 * (rad > Math.PI ? 1 : Math.max(0, Math.sin(rad)));

      const recordedAt = new Date(since.getTime() + 1000);
      positions[deviceId] = [
        {
          latitude: Number(latitude.toFixed(6)),
          longitude: Number(longitude.toFixed(6)),
          speedKmh: Number(speedKmh.toFixed(1)),
          heading: Math.round(((phaseSeconds / 60) * 360) % 360),
          accuracyMeters: 5,
          recordedAt,
          raw: { feed: 'mock', phaseSeconds: Number(phaseSeconds.toFixed(1)) },
        },
      ];
    }

    return positions;
  }
}