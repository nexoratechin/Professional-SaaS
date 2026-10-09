/**
 * Pool of Prisma clients keyed by connection URL, for enterprise tenants on dedicated stores.
 *
 * Shared tenants keep using the single `platformPrismaClient` (no extra pool). Dedicated tenants
 * need a client bound to their schema/database; constructing one per request would exhaust
 * connections, so clients are cached by URL with a small LRU bound. Evicted clients are
 * disconnected in the background.
 */
import { PrismaClient } from '@prisma/client';
import { dbMetricsExtension } from '../observability/db-metrics';

export interface TenantPrismaClientPoolOptions {
  /** The already-constructed shared client (returned for the shared URL). */
  sharedClient: PrismaClient;
  /** The shared connection URL — anything matching it reuses `sharedClient`. */
  sharedUrl: string;
  /** Maximum number of distinct dedicated clients kept open. */
  maxClients?: number;
}

export class TenantPrismaClientPool {
  private readonly sharedClient: PrismaClient;
  private readonly sharedUrl: string;
  private readonly maxClients: number;
  private readonly clients = new Map<string, PrismaClient>();

  constructor(options: TenantPrismaClientPoolOptions) {
    this.sharedClient = options.sharedClient;
    this.sharedUrl = options.sharedUrl;
    this.maxClients = options.maxClients && options.maxClients > 0 ? options.maxClients : 10;
  }

  /** Returns a client for `connectionUrl` — the shared client, or a cached/created dedicated one. */
  getClient(connectionUrl: string): PrismaClient {
    if (connectionUrl === this.sharedUrl) {
      return this.sharedClient;
    }

    const existing = this.clients.get(connectionUrl);
    if (existing) {
      // Refresh LRU position.
      this.clients.delete(connectionUrl);
      this.clients.set(connectionUrl, existing);
      return existing;
    }

    // Dedicated-store clients are instrumented with the same db-metrics extension as the shared
    // client; the cast preserves the pool's public PrismaClient surface.
    const client = new PrismaClient({ datasources: { db: { url: connectionUrl } } }).$extends(
      dbMetricsExtension(),
    ) as unknown as PrismaClient;
    this.clients.set(connectionUrl, client);
    this.evictIfNeeded();
    return client;
  }

  private evictIfNeeded(): void {
    while (this.clients.size > this.maxClients) {
      const oldestKey = this.clients.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      const oldest = this.clients.get(oldestKey);
      this.clients.delete(oldestKey);
      // Best-effort: never let a slow disconnect break request handling.
      void oldest?.$disconnect().catch(() => undefined);
    }
  }

  async disconnectAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map((client) => client.$disconnect()));
  }

  get size(): number {
    return this.clients.size;
  }
}
