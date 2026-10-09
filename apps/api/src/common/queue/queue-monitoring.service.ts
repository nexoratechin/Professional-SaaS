import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { QueueMonitor, backgroundJobService, type BackgroundJobFilter } from '@college-erp/queue';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Read-only queue + job observability for the API process. The worker executes jobs, but queue
 * counts live in Redis and job status in the BackgroundJob table, so the API can report both
 * without running a worker. Backs the platform-ops monitoring endpoints.
 */
@Injectable()
export class QueueMonitoringService implements OnModuleDestroy {
  private readonly monitor: QueueMonitor;

  constructor(config: AppConfigService) {
    const redisUrl = new URL(config.get('REDIS_URL'));
    this.monitor = new QueueMonitor({
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    });
  }

  async overview() {
    const [queues, statusCounts, deadLetterBacklog] = await Promise.all([
      this.monitor.snapshot(),
      backgroundJobService.countsByStatus(),
      this.monitor.deadLetterBacklog(),
    ]);
    return { queues, statusCounts, deadLetterBacklog, generatedAt: new Date().toISOString() };
  }

  recentJobs(filter: BackgroundJobFilter) {
    return backgroundJobService.listRecent(filter);
  }

  async onModuleDestroy(): Promise<void> {
    await this.monitor.close();
  }
}
