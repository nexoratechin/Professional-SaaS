import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { QueueMonitor } from '@college-erp/queue';
import { backgroundJobService } from '@college-erp/queue';
import { AppConfigService } from '../../config/app-config.service';

const SNAPSHOT_INTERVAL_MS = 5 * 60_000;

/**
 * Periodic queue telemetry: logs backlog/health for every queue plus the registry's status counts,
 * so a stalled or failure-heavy queue shows up in the worker logs instead of only being visible if
 * someone happens to open the monitoring endpoint. The interval is unref'd so it never keeps the
 * process alive on shutdown.
 */
@Injectable()
export class QueueMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  private readonly monitor: QueueMonitor;
  private timer?: NodeJS.Timeout;

  constructor(private readonly config: AppConfigService) {
    const redisUrl = new URL(this.config.get('REDIS_URL'));
    this.monitor = new QueueMonitor({
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      maxRetriesPerRequest: null,
    });
  }

  onApplicationBootstrap(): void {
    void this.logSnapshot();
    this.timer = setInterval(() => {
      void this.logSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.monitor.close();
  }

  /** Log one snapshot. Never throws — monitoring must not take the worker down. */
  async logSnapshot(): Promise<void> {
    try {
      const snapshot = await this.monitor.snapshot();
      const statusCounts = await backgroundJobService.countsByStatus();
      const unhealthy = snapshot.filter((entry) => !entry.healthy);
      const backlog = snapshot
        .filter((entry) => entry.backlog > 0)
        .map((entry) => `${entry.name}=${entry.backlog}`)
        .join(' ');

      this.logger.log(
        `Queue snapshot: ${snapshot.length} queues observed; backlog [${backlog || 'none'}]; ` +
          `registry statuses [${statusCounts.map((s) => `${s.status}:${s.count}`).join(' ')}]` +
          `${unhealthy.length ? `; UNHEALTHY: ${unhealthy.map((e) => e.name).join(', ')}` : ''}`,
      );
    } catch (error) {
      this.logger.warn(`Queue snapshot failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
