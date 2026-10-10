/**
 * Redis recovery strategy.
 *
 * Redis in this platform holds three classes of state, in order of importance:
 *  1. BullMQ queues (jobs waiting/delayed/active) — *derived* work: enqueue rows live in
 *     PostgreSQL, so a lost queue can be rebuilt by re-enqueueing, never restored row-by-row.
 *  2. Caches, rate-limit/idempotency keys, and observability windows — safely reconstructible.
 *  3. The worker fleet's heartbeats — regenerated within one heartbeat interval.
 *
 * The recovery position is therefore "persist what you can, prove you can, and be able to rebuild
 * what you lose": AOF+RDB persistence is enforced on the Redis container (docker-compose), this
 * module audits that persistence is actually on and fresh, triggers explicit `BGSAVE` snapshots
 * recorded in backup manifests, and exports the RDB to object storage when `redis-cli` is
 * available. See docs/backup-recovery.md § Redis recovery.
 */
import { stat } from 'node:fs/promises';
import Redis from 'ioredis';
import { computeFileSha256 } from '../manifest';
import { resolveCommand, runCommand } from '../postgres/pg-tools';

export interface RedisPersistenceInfo {
  /** RDB snapshotting configured (save points present) or performed at least once. */
  rdbEnabled: boolean;
  appendOnlyEnabled: boolean;
  appendFsync: string | null;
  /** Epoch seconds of the last successful RDB save; null when Redis has never saved. */
  rdbLastSaveTime: number | null;
  rdbLastBgsaveStatus: string | null;
  rdbBgsaveInProgress: boolean;
  aofLastWriteStatus: string | null;
  loading: boolean;
  usedMemoryHuman: string | null;
  role: string | null;
  redisVersion: string | null;
}

/** Parses `INFO persistence` (plus the couple of server fields we care about) into a typed view. */
export function parseRedisPersistenceInfo(infoText: string): RedisPersistenceInfo {
  const fields = new Map<string, string>();
  for (const line of infoText.split(/\r?\n/)) {
    const match = /^([a-zA-Z0-9_]+):(.*)$/.exec(line.trim());
    if (match && match[1]) fields.set(match[1], match[2] ?? '');
  }
  const get = (key: string): string | null => fields.get(key) ?? null;
  const rdbLastSaveTimeRaw = get('rdb_last_save_time');
  const savePoints = get('save') ?? get('configured_save_points');
  return {
    rdbEnabled: rdbLastSaveTimeRaw !== null || Boolean(savePoints && savePoints.length > 0),
    appendOnlyEnabled: get('aof_enabled') === '1',
    appendFsync: get('appendfsync'),
    rdbLastSaveTime:
      rdbLastSaveTimeRaw && Number.isFinite(Number(rdbLastSaveTimeRaw)) ? Number(rdbLastSaveTimeRaw) : null,
    rdbLastBgsaveStatus: get('rdb_last_bgsave_status'),
    rdbBgsaveInProgress: get('rdb_bgsave_in_progress') === '1',
    aofLastWriteStatus: get('aof_last_write_status'),
    loading: get('loading') === '1',
    usedMemoryHuman: get('used_memory_human'),
    role: get('role'),
    redisVersion: get('redis_version'),
  };
}

export interface RedisRecoveryAssessment {
  ok: boolean;
  /** Human-readable failures, empty when ok. */
  reasons: string[];
  /** Seconds since the last successful RDB save, when known. */
  ageSeconds: number | null;
}

/**
 * A Redis instance is considered recoverable when it persists (AOF or RDB), has saved recently
 * enough for the RPO target, and reports no failed persistence operation. Used by the worker after
 * every snapshot; violations are logged and exposed via metrics.
 */
export function assessRedisRecovery(
  info: RedisPersistenceInfo,
  options: { now?: Date; maxAgeMs: number },
): RedisRecoveryAssessment {
  const reasons: string[] = [];
  const now = options.now ?? new Date();
  const ageSeconds =
    info.rdbLastSaveTime !== null ? Math.max(0, Math.round(now.getTime() / 1000 - info.rdbLastSaveTime)) : null;

  if (!info.appendOnlyEnabled && !info.rdbEnabled) {
    reasons.push(
      'Neither AOF nor RDB persistence is configured — a Redis restart would lose all queued jobs and cache state.',
    );
  }
  if (info.rdbLastBgsaveStatus !== null && info.rdbLastBgsaveStatus !== 'ok') {
    reasons.push(`Last background RDB save failed (rdb_last_bgsave_status=${info.rdbLastBgsaveStatus}).`);
  }
  if (info.appendOnlyEnabled && info.aofLastWriteStatus !== null && info.aofLastWriteStatus !== 'ok') {
    reasons.push(`Last AOF write failed (aof_last_write_status=${info.aofLastWriteStatus}).`);
  }
  if (ageSeconds === null) {
    reasons.push('Redis has never completed an RDB save.');
  } else if (ageSeconds * 1000 > options.maxAgeMs) {
    reasons.push(
      `Last RDB save is ${Math.round(ageSeconds / 60)} minutes old (threshold ${Math.round(
        options.maxAgeMs / 60_000,
      )} minutes).`,
    );
  }
  return { ok: reasons.length === 0, reasons, ageSeconds };
}

/** Password is moved to REDISCLI_AUTH; the URL handed to argv is redacted. */
export function redisCliConnection(redisUrl: string): { sanitizedUrl: string; password?: string } {
  const parsed = new URL(redisUrl);
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  if (password) parsed.password = '';
  return { sanitizedUrl: parsed.toString(), ...(password ? { password } : {}) };
}

export interface RedisSnapshotResult {
  ok: boolean;
  /** False when a save was already running and this call simply waited for it. */
  triggered: boolean;
  lastSaveTime: number | null;
  durationMs: number;
  info: RedisPersistenceInfo;
  error?: string;
}

const DEFAULT_SNAPSHOT_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

export interface RedisRdbExportResult {
  outputPath: string;
  sizeBytes: number;
  sha256: string;
  durationMs: number;
}

/**
 * Talks to a live Redis. The manager owns a single ioredis connection (created eagerly by
 * `connect()`), usable from the worker and from the CLI. `close()` is idempotent.
 */
export class RedisRecoveryManager {
  private client: Redis | null = null;

  constructor(
    private readonly options: {
      redisUrl: string;
      /** Explicit `redis-cli` path for RDB export (BACKUP_REDIS_CLI_PATH). */
      redisCliPath?: string;
      logger?: (message: string) => void;
    },
  ) {}

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.options.redisUrl, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
        enableOfflineQueue: true,
      });
    }
    return this.client;
  }

  async inspect(): Promise<RedisPersistenceInfo> {
    const client = this.getClient();
    const [persistence, server] = await Promise.all([client.info('persistence'), client.info('server')]);
    return parseRedisPersistenceInfo(`${persistence}\n${server}`);
  }

  /**
   * Triggers `BGSAVE` and waits for completion (or for a concurrent save to finish). Fails only
   * when Redis reports a save error or the wait times out — a running save is not an error.
   */
  async snapshot(options: { waitTimeoutMs?: number; pollIntervalMs?: number } = {}): Promise<RedisSnapshotResult> {
    const startedAt = Date.now();
    const client = this.getClient();
    const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_SNAPSHOT_WAIT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

    let triggered = false;
    let before = await this.inspect();
    try {
      await client.bgsave();
      triggered = true;
    } catch (error) {
      // "Background save already in progress" is fine: wait for that one instead.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes('already in progress')) {
        const info = before;
        return {
          ok: false,
          triggered: false,
          lastSaveTime: info.rdbLastSaveTime,
          durationMs: Date.now() - startedAt,
          info,
          error: message,
        };
      }
    }
    before = await this.inspect();

    const deadline = Date.now() + waitTimeoutMs;
    let info = before;
    while (info.rdbBgsaveInProgress && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      info = await this.inspect();
    }
    const ok = !info.rdbBgsaveInProgress && (info.rdbLastBgsaveStatus ?? 'ok') === 'ok';
    return {
      ok,
      triggered,
      lastSaveTime: info.rdbLastSaveTime,
      durationMs: Date.now() - startedAt,
      info,
      ...(ok
        ? {}
        : {
            error: info.rdbBgsaveInProgress
              ? `Timed out after ${waitTimeoutMs}ms waiting for BGSAVE to finish.`
              : `BGSAVE failed: rdb_last_bgsave_status=${info.rdbLastBgsaveStatus ?? 'unknown'}`,
          }),
    };
  }

  /**
   * Streams the current RDB out of Redis with `redis-cli --rdb`. This is the copy that actually
   * leaves the Redis data volume, so it can be uploaded to object storage.
   */
  async exportRdb(options: { outputPath: string; timeoutMs?: number }): Promise<RedisRdbExportResult> {
    const redisCli = resolveCommand('redis-cli', this.options.redisCliPath);
    if (!redisCli) {
      throw new Error(
        'redis-cli was not found. Install the Redis tools (redis) or set BACKUP_REDIS_CLI_PATH.',
      );
    }
    const startedAt = Date.now();
    const connection = redisCliConnection(this.options.redisUrl);
    await runCommand(redisCli, ['-u', connection.sanitizedUrl, '--rdb', options.outputPath], {
      env: connection.password ? { ...process.env, REDISCLI_AUTH: connection.password } : process.env,
      timeoutMs: options.timeoutMs ?? 120_000,
    });
    const [fileStat, sha256] = await Promise.all([stat(options.outputPath), computeFileSha256(options.outputPath)]);
    return {
      outputPath: options.outputPath,
      sizeBytes: fileStat.size,
      sha256,
      durationMs: Date.now() - startedAt,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      const client = this.client;
      this.client = null;
      await client.quit().catch(() => client.disconnect());
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
