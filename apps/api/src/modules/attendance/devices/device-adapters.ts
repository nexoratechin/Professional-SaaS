/**
 * Device adapter registry — the vendor-neutral seam between the ERP and physical attendance
 * hardware. A device announces (protocol, vendor, endpointUrl/ipAddress/port, commKey); the
 * registry resolves a pull adapter that returns RAW vendor payloads, which are then pushed through
 * the SAME normalized ingest pipeline as HTTP_PUSH events. Adding a new vendor = registering an
 * adapter function here (or registering at runtime), never an ERP schema/business-logic change.
 *
 * Ships with a generic HTTP pull adapter (protocol HTTP_PULL) that reads a JSON documents
 * endpoint and returns its payload; TCP/MQTT vendors are expected to register their own adapter.
 */
import { Logger } from '@nestjs/common';

export interface DevicePullContext {
  protocol: string;
  vendor: string;
  endpointUrl?: string | null;
  ipAddress?: string | null;
  port?: number | null;
  /** Decrypted vendor communication key (never persisted in plaintext). */
  commKey?: string | null;
}

export interface DevicePullResult {
  rawEvents: unknown;
  meta: { source: string; vendor: string; fetchedAt: string };
}

export type DeviceAdapter = (ctx: DevicePullContext) => Promise<DevicePullResult> | DevicePullResult;

const logger = new Logger('DeviceAdapterRegistry');

const GENERIC_HTTP_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

async function httpPullAdapter(ctx: DevicePullContext): Promise<DevicePullResult> {
  const url = ctx.endpointUrl || (ctx.ipAddress ? `http://${ctx.ipAddress}${ctx.port ? `:${ctx.port}` : ''}` : null);
  if (!url) {
    throw new Error('HTTP_PULL device requires an endpointUrl (or ipAddress[:port]).');
  }
  const headers: Record<string, string> = { ...GENERIC_HTTP_HEADERS };
  if (ctx.commKey) headers['Authorization'] = `Bearer ${ctx.commKey}`;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Device pull failed with HTTP ${response.status} from ${url}.`);
  }
  const rawEvents: unknown = await response.json();
  return { rawEvents, meta: { source: url, vendor: ctx.vendor, fetchedAt: new Date().toISOString() } };
}

export class DeviceAdapterRegistry {
  private readonly adapters = new Map<string, DeviceAdapter>();

  constructor() {
    // Generic HTTP pull works for any vendor exposing a JSON documents endpoint out of the box.
    this.register('HTTP_PULL', '*', httpPullAdapter);
  }

  register(protocol: string, vendor: string, adapter: DeviceAdapter): void {
    const key = this.key(protocol, vendor);
    this.adapters.set(key, adapter);

    // ALSO mirror the `v:*` (catch-all vendor) slot if the caller registers for a wildcard vendor.
    if (vendor === '*') {
      logger.debug(`Registered vendor-neutral adapter for protocol ${protocol}`);
    }
  }

  /** Resolves an adapter for a device, falling back protocol-wide (vendor `*`) then to nothing. */
  resolve(ctx: { protocol: string; vendor: string }): DeviceAdapter | null {
    const exact = this.adapters.get(this.key(ctx.protocol, ctx.vendor));
    if (exact) return exact;
    return this.adapters.get(this.key(ctx.protocol, '*')) ?? null;
  }

  async pull(ctx: DevicePullContext): Promise<DevicePullResult> {
    const adapter = this.resolve(ctx);
    if (!adapter) {
      throw new Error(
        `No attendance device adapter registered for protocol "${ctx.protocol}" vendor "${ctx.vendor}". ` +
          'Register one in DeviceAdapterRegistry to enable pulling from this hardware.',
      );
    }
    logger.debug(`Pulling attendance events via ${ctx.protocol}/${ctx.vendor}`);
    return adapter(ctx);
  }

  private key(protocol: string, vendor: string): string {
    return `${protocol.toLowerCase()}:${vendor.toLowerCase()}`;
  }
}

/** Singleton registry shared by the attendance-devices service. */
export const deviceAdapterRegistry = new DeviceAdapterRegistry();