import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { defaultJobOptions } from '@college-erp/queue';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import type { BackupPruneJobData, PostgresBackupJobData, RedisSnapshotJobData } from '@college-erp/types';

const HOUR_MS = 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * HOUR_MS;

/**
 * Registers the recurring backup jobs on worker startup. Fixed jobIds make BullMQ dedupe the
 * schedules across restarts, so re-registering on every boot never doubles the cadence.
 *
 * Cadence comes from configuration (BACKUP_INTERVAL_HOURS, default 24h = the documented RPO
 * driver); the prune sweep runs daily regardless; Redis snapshots run on their own schedule
 * because they are seconds-fast and worth doing more often than the full dump.
 */
@Injectable()
export class BackupSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.BACKUP) private readonly queue: Queue<PostgresBackupJobData | RedisSnapshotJobData | BackupPruneJobData>,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('BACKUP_ENABLED')) {
      this.logger.log('Backup scheduler disabled (BACKUP_ENABLED=false).');
      return;
    }

    const backupIntervalMs = this.config.get('BACKUP_INTERVAL_HOURS') * HOUR_MS;
    await this.queue.add(
      'postgres-backup',
      { requestedBy: 'schedule' },
      { ...defaultJobOptions(QUEUE_NAMES.BACKUP), repeat: { every: backupIntervalMs }, jobId: 'backup-postgres-scheduled' },
    );
    await this.queue.add(
      'backup-prune',
      {},
      { ...defaultJobOptions(QUEUE_NAMES.BACKUP), repeat: { every: PRUNE_INTERVAL_MS }, jobId: 'backup-prune-daily' },
    );

    let redisCadence = 'disabled';
    if (this.config.get('BACKUP_REDIS_ENABLED')) {
      const redisIntervalMs = this.config.get('BACKUP_REDIS_INTERVAL_HOURS') * HOUR_MS;
      await this.queue.add(
        'redis-snapshot',
        { requestedBy: 'schedule' },
        {
          ...defaultJobOptions(QUEUE_NAMES.BACKUP),
          repeat: { every: redisIntervalMs },
          jobId: 'backup-redis-scheduled',
        },
      );
      redisCadence = `every ${this.config.get('BACKUP_REDIS_INTERVAL_HOURS')}h`;
    }

    this.logger.log(
      `Backup scheduler registered: postgres every ${this.config.get('BACKUP_INTERVAL_HOURS')}h ` +
        `(restore-verify ${this.config.get('BACKUP_VERIFY_RESTORE_ENABLED') ? 'on' : 'off'}), ` +
        `redis ${redisCadence}, retention daily.`,
    );
  }
}
