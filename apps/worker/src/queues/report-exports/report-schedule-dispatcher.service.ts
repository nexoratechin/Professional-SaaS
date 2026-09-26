import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient, type Prisma } from '@college-erp/database';
import { calculateNextRunAt, type ReportFilters } from '@college-erp/reporting';
import { QUEUE_NAMES } from '@college-erp/types';

const DISPATCH_INTERVAL_MS = 60_000;

/**
 * Discovers due report schedules across tenants, then creates and enqueues each run through the
 * owning tenant's scoped client. The due row is claimed with a conditional update on its exact
 * nextRunAt before a run is created, so two worker instances can never double-dispatch a schedule.
 */
@Injectable()
export class ReportScheduleDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportScheduleDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@InjectQueue(QUEUE_NAMES.REPORT_EXPORTS) private readonly queue: Queue) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDueSchedules(), DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.dispatchDueSchedules();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatchDueSchedules(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let dispatched = 0;
    try {
      const due = await platformPrismaClient.reportSchedule.findMany({
        where: { isActive: true, nextRunAt: { lte: now } },
        select: { id: true, tenantId: true },
        orderBy: { nextRunAt: 'asc' },
        take: 100,
      });
      for (const candidate of due) {
        try {
          if (await this.dispatchOne(candidate.tenantId, candidate.id, now)) dispatched += 1;
        } catch (error) {
          this.logger.error(`Failed to dispatch report schedule ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return dispatched;
  }

  private async dispatchOne(tenantId: string, scheduleId: string, now: Date): Promise<boolean> {
    const db = createTenantScopedClient(tenantId);
    const schedule = await db.reportSchedule.findFirst({ where: { id: scheduleId, isActive: true } });
    if (!schedule || schedule.nextRunAt.getTime() > now.getTime()) return false;

    const nextRunAt = calculateNextRunAt(
      {
        frequency: schedule.frequency,
        timeOfDay: schedule.timeOfDay,
        timezone: schedule.timezone,
        dayOfWeek: schedule.dayOfWeek,
        dayOfMonth: schedule.dayOfMonth,
      },
      now,
    );

    const claimed = await db.reportSchedule.updateMany({
      where: { id: scheduleId, isActive: true, nextRunAt: schedule.nextRunAt },
      data: { lastRunAt: now, nextRunAt },
    });
    if (claimed.count === 0) return false;

    const template = schedule.templateId
      ? await db.reportTemplate.findFirst({ where: { id: schedule.templateId }, select: { definition: true } })
      : null;

    const run = await (db.reportRun as unknown as { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> }).create({
      data: {
        reportType: schedule.reportType,
        format: schedule.format,
        status: 'QUEUED',
        filters: (schedule.filters ?? {}) as Prisma.InputJsonValue,
        scopeSnapshot: (schedule.scopeSnapshot ?? {}) as Prisma.InputJsonValue,
        templateSnapshot: template ? (template.definition as Prisma.InputJsonValue) : undefined,
        requestedById: schedule.createdById,
        templateId: schedule.templateId,
        scheduleId: schedule.id,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      },
    });

    try {
      await this.queue.add(
        'generate',
        { tenantId, runId: run.id },
        { jobId: `report-${run.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 },
      );
    } catch (error) {
      await db.reportRun.updateMany({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: 'Could not enqueue scheduled report export.', completedAt: new Date() },
      });
      throw error;
    }

    const filters = (schedule.filters as ReportFilters | null) ?? {};
    this.logger.log(`Dispatched schedule ${schedule.id} (${schedule.reportType}, ${Object.keys(filters).length} filters).`);
    return true;
  }
}
