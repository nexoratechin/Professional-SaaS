import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { QueueMonitor, backgroundJobService, type BackgroundJobFilter } from '@college-erp/queue';
import { recordDeadLetterBacklog, recordQueueSnapshot } from '@college-erp/observability';
import { AppConfigService } from '../../config/app-config.service';

const METRICS_REFRESH_INTERVAL_MS = 30_000;

/**
 * Read-only queue + job observability for the API process. The worker executes jobs, but queue
 * counts live in Redis and job status in the BackgroundJob table, so the API can report both
 * without running a worker. Backs the platform-ops monitoring endpoints AND the queue gauges on
 * /metrics: a 30s sampler keeps the gauges warm, and `ensureFreshMetrics()` lets a scrape force a
 * refresh when the periodic sample is stale (so a fresh Prometheus pull is never older than the
 * scrape interval allows).
 */
@Injectable()
export class QueueMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitoringService.name);
  private readonly monitor: QueueMonitor;
  private refreshTimer?: NodeJS.Timeout;
  private lastMetricsRefreshAt = 0;
  private refreshing?: Promise<void>;

  constructor(config: AppConfigService) {
    const redisUrl = new URL(config.get('REDIS_URL'));
    this.monitor = new QueueMonitor({
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    });
  }

  onModuleInit(): void {
    this.refreshTimer = setInterval(() => {
      void this.refreshMetrics().catch(() => undefined);
    }, METRICS_REFRESH_INTERVAL_MS);
    this.refreshTimer.unref();
    void this.refreshMetrics().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.monitor.close();
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

  /** Refreshes queue gauges when the last sample is older than `maxAgeMs` (default: always). */
  async ensureFreshMetrics(maxAgeMs = 0): Promise<void> {
    if (maxAgeMs > 0 && Date.now() - this.lastMetricsRefreshAt < maxAgeMs) return;
    await this.refreshMetrics();
  }

  /** One sampling pass: publishes per-queue job counts/backlog and the dead-letter backlog. */
  async refreshMetrics(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const queues = await this.monitor.snapshot();
        for (const queue of queues) {
          recordQueueSnapshot(queue.name, queue.counts);
        }
        recordDeadLetterBacklog(await this.monitor.deadLetterBacklog());
        this.lastMetricsRefreshAt = Date.now();
      } catch (error) {
        // Redis may be down; /metrics should still answer with whatever is known.
        this.logger.warn(`Queue metrics refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }
}
