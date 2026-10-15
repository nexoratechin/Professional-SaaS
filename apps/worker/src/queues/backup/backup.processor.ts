import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { processorOptions } from '@college-erp/queue';
import type { BackupPruneJobData, MysqlBackupJobData, RedisSnapshotJobData } from '@college-erp/types';
import { QUEUE_NAMES } from '@college-erp/types';
import { BackupService } from './backup.service';

/**
 * Backup queue processor. Job names:
 *  - `mysql-backup`      mysqldump + verify + upload + heartbeat (+ retention)
 *  - `redis-snapshot`    BGSAVE + persistence assessment + optional RDB export
 *  - `backup-prune`      GFS retention sweep only (scheduler-owned)
 *
 * Jobs are platform maintenance, not tenant-scoped: the dump covers the whole shared database.
 */
@Processor(QUEUE_NAMES.BACKUP, processorOptions(QUEUE_NAMES.BACKUP))
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly backup: BackupService) {
    super();
  }

  override async process(
    job: Job<MysqlBackupJobData | RedisSnapshotJobData | BackupPruneJobData>,
  ): Promise<unknown> {
    switch (job.name) {
      case 'mysql-backup': {
        const data = (job.data ?? {}) as MysqlBackupJobData;
        return this.backup.runMysqlBackup({
          requestedBy: data.requestedBy ?? 'schedule',
          ...(data.verifyRestore !== undefined ? { verifyRestore: data.verifyRestore } : {}),
        });
      }
      case 'redis-snapshot':
        return this.backup.runRedisSnapshot();
      case 'backup-prune':
        return this.backup.pruneAll();
      default:
        this.logger.error(`Unknown backup job "${job.name}" (id=${job.id}); failing it.`);
        throw new Error(`Unknown backup job "${job.name}".`);
    }
  }
}
