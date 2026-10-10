import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  BACKUP_LAST_SUCCESS_KEYS,
  BACKUP_LAST_SUCCESS_TTL_SECONDS,
  recordBackupEvent,
  recordBackupVerification,
  setBackupLastSuccess,
} from '@college-erp/observability';
import {
  RedisRecoveryManager,
  assessRedisRecovery,
  buildBackupId,
  buildBackupObjectKey,
  buildManifestObjectKey,
  buildScratchDatabaseName,
  computeBufferSha256,
  createBackupManifest,
  createPostgresBackup,
  defaultPostgresProbes,
  dropDatabase,
  parseBackupIdTimestamp,
  planRetention,
  restorePostgresBackup,
  runIntegrityProbes,
  serializeBackupManifest,
  toAdminDatabaseUrl,
  verifyPostgresArchive,
  type BackupManifest,
  type BackupProbeResult,
  type BackupVerification,
} from '@college-erp/backup';
import type Redis from 'ioredis';
import { WORKER_REDIS_CLIENT } from '../../common/observability/redis.constants';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';
import { AppConfigService } from '../../config/app-config.service';

type BackupKindLabel = 'postgres' | 'redis';

/**
 * Backup orchestration for the worker.
 *
 * The heavy lifting (pg_dump, TOC verification, restore into a scratch database, Redis snapshots,
 * GFS retention) lives in `@college-erp/backup`; this service binds it to configuration, object
 * storage, Redis and the metrics/alerting pipeline:
 *
 *   pg_dump -> TOC verify -> [optional restore verify] -> upload archive + manifest to S3
 *          -> record last-success heartbeat (the API's backup_stale alert reads it)
 *          -> prune archives per the GFS retention policy
 *
 * Every step is idempotent from the scheduler's point of view: a retried job simply produces a new
 * backup id and prunes again. See docs/backup-recovery.md.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly storage: WorkerStorageService,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Full PostgreSQL backup + verification + upload + heartbeat + retention. */
  async runPostgresBackup(options: { verifyRestore?: boolean; requestedBy?: string } = {}): Promise<BackupManifest> {
    const startedAt = Date.now();
    const environment = this.environment();
    const prefix = this.config.get('BACKUP_S3_PREFIX');
    const id = buildBackupId();
    const objectKey = buildBackupObjectKey({ prefix, environment, kind: 'POSTGRES_FULL', id, extension: 'dump' });
    const manifestKey = buildManifestObjectKey({ prefix, environment, kind: 'POSTGRES_FULL', id });
    const workDir = await mkdtemp(join(tmpdir(), 'college-erp-backup-'));
    const archivePath = join(workDir, `${id}.dump`);

    try {
      this.logger.log(`PostgreSQL backup ${id} starting (environment=${environment}, requestedBy=${options.requestedBy ?? 'schedule'}).`);
      const backup = await createPostgresBackup({
        databaseUrl: this.config.get('DATABASE_URL'),
        outputPath: archivePath,
        ...(this.config.get('BACKUP_PG_DUMP_PATH') ? { pgDumpPath: this.config.get('BACKUP_PG_DUMP_PATH') } : {}),
        timeoutMs: this.config.get('BACKUP_TIMEOUT_MS'),
      });

      const toc = await verifyPostgresArchive({
        archivePath,
        ...(this.config.get('BACKUP_PG_RESTORE_PATH') ? { pgRestorePath: this.config.get('BACKUP_PG_RESTORE_PATH') } : {}),
      });
      recordBackupVerification('postgres', 'toc', toc.ok);
      if (!toc.ok) {
        throw new Error(`Backup ${id} failed structure verification: ${toc.error ?? 'unknown reason'}`);
      }

      let verification: BackupVerification = {
        verifiedAt: new Date().toISOString(),
        method: 'toc',
        ok: true,
        tableCount: toc.tableCount,
        durationMs: toc.durationMs,
      };
      if (options.verifyRestore ?? this.config.get('BACKUP_VERIFY_RESTORE_ENABLED')) {
        verification = await this.restoreVerify(id, archivePath, toc.tableCount);
      }

      const manifest = createBackupManifest({
        id,
        kind: 'POSTGRES_FULL',
        format: 'pg-custom',
        environment,
        databaseName: backup.databaseName,
        objectKey,
        sizeBytes: backup.sizeBytes,
        sha256: backup.sha256,
        ...(backup.toolVersion ? { toolVersion: backup.toolVersion } : {}),
        verification,
        metadata: {
          requestedBy: options.requestedBy ?? 'schedule',
          durationMs: Date.now() - startedAt,
        },
      });

      await this.storage.uploadSystemFile(objectKey, archivePath, 'application/octet-stream');
      await this.storage.uploadSystemBuffer(manifestKey, Buffer.from(serializeBackupManifest(manifest)), 'application/json');

      const nowSeconds = Math.floor(Date.now() / 1000);
      await this.redis.set(BACKUP_LAST_SUCCESS_KEYS.postgres, String(nowSeconds), 'EX', BACKUP_LAST_SUCCESS_TTL_SECONDS);
      recordBackupEvent('postgres', 'success', backup.sizeBytes);
      setBackupLastSuccess('postgres', nowSeconds);
      this.logger.log(
        `PostgreSQL backup ${id} complete: ${(backup.sizeBytes / 1024 / 1024).toFixed(2)} MiB, ` +
          `${toc.tableCount} table(s), verification=${verification.method}/${verification.ok ? 'ok' : 'failed'}, ` +
          `duration=${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
      );

      await this.pruneRetention('postgres').catch((error: unknown) => {
        this.logger.warn(`Retention prune failed after backup ${id}: ${describe(error)}`);
      });
      return manifest;
    } catch (error) {
      recordBackupEvent('postgres', 'failure');
      this.logger.error(`PostgreSQL backup ${id} FAILED: ${describe(error)}`);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Redis snapshot heartbeat + optional RDB export to object storage. */
  async runRedisSnapshot(): Promise<BackupManifest> {
    const startedAt = Date.now();
    const environment = this.environment();
    const prefix = this.config.get('BACKUP_S3_PREFIX');
    const id = buildBackupId();
    const manifestKey = buildManifestObjectKey({ prefix, environment, kind: 'REDIS_SNAPSHOT', id });
    const workDir = await mkdtemp(join(tmpdir(), 'college-erp-redis-backup-'));
    const rdbPath = join(workDir, `${id}.rdb`);
    const manager = new RedisRecoveryManager({
      redisUrl: this.config.get('REDIS_URL'),
      ...(this.config.get('BACKUP_REDIS_CLI_PATH') ? { redisCliPath: this.config.get('BACKUP_REDIS_CLI_PATH') } : {}),
    });

    try {
      this.logger.log(`Redis snapshot ${id} starting.`);
      const snapshot = await manager.snapshot({});
      if (!snapshot.ok) {
        throw new Error(snapshot.error ?? 'BGSAVE failed.');
      }
      const assessment = assessRedisRecovery(snapshot.info, {
        maxAgeMs: this.config.get('BACKUP_REDIS_MAX_AGE_HOURS') * 3_600_000,
      });
      if (!assessment.ok) {
        this.logger.warn(`Redis persistence assessment is negative: ${assessment.reasons.join(' ')}`);
      }

      let archive: { objectKey: string; sizeBytes: number; sha256: string } | null = null;
      if (this.config.get('BACKUP_REDIS_RDB_EXPORT_ENABLED')) {
        try {
          const objectKey = buildBackupObjectKey({ prefix, environment, kind: 'REDIS_SNAPSHOT', id, extension: 'rdb' });
          const exported = await manager.exportRdb({ outputPath: rdbPath });
          await this.storage.uploadSystemFile(objectKey, rdbPath, 'application/octet-stream');
          archive = { objectKey, sizeBytes: exported.sizeBytes, sha256: exported.sha256 };
        } catch (error) {
          // The BGSAVE succeeded and is the recoverable snapshot on the Redis volume; the off-host
          // copy is best-effort (redis-cli may not be installed, or SYNC may be disabled).
          this.logger.warn(
            `Redis RDB export skipped (BGSAVE heartbeat is still recorded): ${describe(error)}`,
          );
        }
      } else {
        this.logger.log('Redis RDB export disabled (BACKUP_REDIS_RDB_EXPORT_ENABLED=false).');
      }

      const manifest = createBackupManifest({
        id,
        kind: 'REDIS_SNAPSHOT',
        format: archive ? 'redis-rdb' : 'redis-info',
        environment,
        objectKey: archive?.objectKey ?? manifestKey,
        sizeBytes: archive?.sizeBytes ?? 0,
        sha256: archive?.sha256 ?? computeBufferSha256(Buffer.from('')),
        ...(snapshot.lastSaveTime !== null
          ? { createdAt: new Date(snapshot.lastSaveTime * 1000).toISOString() }
          : {}),
        metadata: {
          requestedBy: 'schedule',
          durationMs: Date.now() - startedAt,
          snapshot: {
            ok: snapshot.ok,
            triggered: snapshot.triggered,
            lastSaveTime: snapshot.lastSaveTime,
          },
          assessment,
          persistence: snapshot.info,
        },
      });
      await this.storage.uploadSystemBuffer(manifestKey, Buffer.from(serializeBackupManifest(manifest)), 'application/json');

      const nowSeconds = Math.floor(Date.now() / 1000);
      await this.redis.set(BACKUP_LAST_SUCCESS_KEYS.redis, String(nowSeconds), 'EX', BACKUP_LAST_SUCCESS_TTL_SECONDS);
      recordBackupEvent('redis', 'success', archive?.sizeBytes);
      setBackupLastSuccess('redis', nowSeconds);
      this.logger.log(
        `Redis snapshot ${id} complete: rdbExport=${archive ? 'yes' : 'no'}, lastSave=${
          snapshot.lastSaveTime ?? 'unknown'
        }, assessment=${assessment.ok ? 'ok' : 'warn'}.`,
      );

      await this.pruneRetention('redis').catch((error: unknown) => {
        this.logger.warn(`Redis retention prune failed after snapshot ${id}: ${describe(error)}`);
      });
      return manifest;
    } catch (error) {
      recordBackupEvent('redis', 'failure');
      this.logger.error(`Redis snapshot ${id} FAILED: ${describe(error)}`);
      throw error;
    } finally {
      await manager.close().catch(() => undefined);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** GFS retention for both archive kinds. */
  async pruneAll(): Promise<void> {
    await this.pruneRetention('postgres');
    await this.pruneRetention('redis');
  }

  private async pruneRetention(kind: BackupKindLabel): Promise<void> {
    const prefix = `${this.config.get('BACKUP_S3_PREFIX')}/${this.environment()}/${kind}/`;
    const objects = await this.storage.listSystemObjects(prefix);
    const extension = kind === 'postgres' ? '.dump' : '.rdb';
    const archives = objects.filter((object) => object.key.endsWith(extension));
    const entries = archives.map((object) => ({
      key: object.key,
      createdAt: parseBackupIdTimestamp(basename(object.key).slice(0, -extension.length)) ?? object.lastModified ?? new Date(0),
    }));
    const plan = planRetention(entries, {
      daily: this.config.get('BACKUP_RETENTION_DAILY'),
      weekly: this.config.get('BACKUP_RETENTION_WEEKLY'),
      monthly: this.config.get('BACKUP_RETENTION_MONTHLY'),
    });
    for (const key of plan.delete) {
      await this.storage.deleteSystemObject(key);
      await this.storage.deleteSystemObject(key.slice(0, -extension.length) + '.manifest.json');
    }
    if (plan.delete.length > 0) {
      this.logger.log(
        `Retention pruned ${plan.delete.length} ${kind} archive(s); ${plan.keep.length} retained ` +
          `(daily=${this.config.get('BACKUP_RETENTION_DAILY')}, weekly=${this.config.get('BACKUP_RETENTION_WEEKLY')}, monthly=${this.config.get('BACKUP_RETENTION_MONTHLY')}).`,
      );
    }
  }

  /**
   * Restores the just-taken archive into a scratch database and runs the default integrity probes.
   * The scratch database is always dropped, even when verification fails, so repeated runs cannot
   * leak databases. A failed verification fails the job — an unverified backup must page.
   */
  private async restoreVerify(id: string, archivePath: string, tableCount: number): Promise<BackupVerification> {
    const startedAt = Date.now();
    const adminUrl = this.config.get('BACKUP_SCRATCH_DATABASE_URL') ?? toAdminDatabaseUrl(this.config.get('DATABASE_URL'));
    const scratchName = buildScratchDatabaseName(this.config.get('BACKUP_SCRATCH_DATABASE_PREFIX'), id);
    const targetUrl = (() => {
      const url = new URL(adminUrl);
      url.pathname = `/${scratchName}`;
      return url.toString();
    })();

    let verificationRecorded = false;
    try {
      await restorePostgresBackup({
        archivePath,
        targetDatabaseUrl: targetUrl,
        create: true,
        adminDatabaseUrl: adminUrl,
        ...(this.config.get('BACKUP_PG_RESTORE_PATH') ? { pgRestorePath: this.config.get('BACKUP_PG_RESTORE_PATH') } : {}),
        ...(this.config.get('BACKUP_PSQL_PATH') ? { psqlPath: this.config.get('BACKUP_PSQL_PATH') } : {}),
        timeoutMs: this.config.get('BACKUP_TIMEOUT_MS'),
      });
      const probes = await runIntegrityProbes({
        databaseUrl: targetUrl,
        probes: defaultPostgresProbes(),
        ...(this.config.get('BACKUP_PSQL_PATH') ? { psqlPath: this.config.get('BACKUP_PSQL_PATH') } : {}),
      });
      const ok = probes.every((probe) => probe.ok);
      recordBackupVerification('postgres', 'restore', ok);
      verificationRecorded = true;
      const result: BackupProbeResult[] = probes.map((probe) => ({
        name: probe.name,
        value: probe.value,
        ok: probe.ok,
        ...(probe.expected ? { expected: probe.expected } : {}),
        ...(probe.error ? { error: probe.error } : {}),
      }));
      if (!ok) {
        throw new Error(
          `Restore verification failed for ${id}: ${probes
            .filter((probe) => !probe.ok)
            .map((probe) => `${probe.name}=${probe.value ?? 'error'}`)
            .join(', ')}`,
        );
      }
      this.logger.log(
        `Restore verification for ${id} passed (${probes.length} probes, ${Date.now() - startedAt}ms).`,
      );
      return {
        verifiedAt: new Date().toISOString(),
        method: 'restore',
        ok: true,
        tableCount,
        probes: result,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (!verificationRecorded) {
        recordBackupVerification('postgres', 'restore', false);
      }
      throw error;
    } finally {
      await dropDatabase({
        adminDatabaseUrl: adminUrl,
        name: scratchName,
        ...(this.config.get('BACKUP_PSQL_PATH') ? { psqlPath: this.config.get('BACKUP_PSQL_PATH') } : {}),
      }).catch((error: unknown) => {
        this.logger.warn(`Could not drop scratch database ${scratchName}: ${describe(error)}`);
      });
    }
  }

  private environment(): string {
    return this.config.get('BACKUP_ENVIRONMENT') ?? this.config.get('NODE_ENV');
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
