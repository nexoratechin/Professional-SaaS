import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type WorkflowEscalationSweepJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** Self-registers its own recurring sweep on worker startup — a fixed jobId makes BullMQ dedupe
 * this across restarts, so re-registering on every boot never produces duplicate schedules. */
@Injectable()
export class WorkflowEscalationSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowEscalationSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.WORKFLOW_ESCALATION) private readonly queue: Queue<WorkflowEscalationSweepJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'sweep',
      {},
      { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'workflow-escalation-sweep' },
    );
    this.logger.log(`Registered workflow escalation sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}
