/**
 * Synchronization runs — the tenant-facing half of sync.
 *
 * ## Why the API does not execute runs
 *
 * A sync is long-running, resumable, and page-bounded; it belongs on the worker. This service owns
 * the two things the API is actually good at — validating that a run is *allowed* and making it
 * *visible* the instant it is requested — and then hands execution to apps/worker's
 * IntegrationSyncProcessor. There is exactly one implementation of the run loop, so a sync cannot
 * behave differently depending on who started it.
 *
 * ## Why the run row is created before anything is queued
 *
 * Creating IntegrationSyncRun synchronously means an operator sees "sync requested" in the UI even if
 * no worker is up, instead of the click appearing to do nothing. The row is the request; the queue
 * is only the transport.
 *
 * ## The decisions live in the package
 *
 * Change detection, run-status derivation and pagination policy are pure functions in
 * @college-erp/integrations/sync.ts with unit tests. This file validates capability and persists the
 * request; it never re-derives those rules.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  IntegrationAdapterRegistry,
  categorySupports,
  type SyncMode,
} from '@college-erp/integrations';
import { QUEUE_NAMES, type IntegrationSyncRunJobData } from '@college-erp/types';
import type { IntegrationSyncTrigger, Prisma } from '@college-erp/database';
import { IntegrationsService } from './integrations.service';

export interface CreateRunInput {
  tenantId: string;
  integrationId: string;
  entityType: string;
  mode: SyncMode;
  scope?: Record<string, unknown>;
  pageSize?: number;
  trigger: IntegrationSyncTrigger;
  requestedBy?: string;
}

@Injectable()
export class IntegrationsSyncService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly registry: IntegrationAdapterRegistry,
    @InjectQueue(QUEUE_NAMES.INTEGRATION_SYNC)
    private readonly queue: Queue<IntegrationSyncRunJobData>,
  ) {}

  /**
   * Validates, creates the run row, and enqueues it.
   *
   * Three independent gates have to pass, each answering a different question:
   *   1. is the connection ACTIVE (the kill switch);
   *   2. does the CATEGORY support this mode at all (an SMS gateway has no remote records to pull);
   *   3. does this PROVIDER implement it.
   * Checking only the category would let a webhook-only integration be scheduled for a pull that can
   * never succeed, and checking only the provider would give a confusing message for a category that
   * simply has nothing to sync.
   */
  async createRun(input: CreateRunInput) {
    const integration = await this.integrationsService.requireIntegration(input.integrationId);

    if (integration.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Integration "${integration.key}" is ${integration.status}; only ACTIVE integrations can sync.`,
      );
    }
    if (!categorySupports(integration.category, input.mode)) {
      throw new BadRequestException(
        `Category ${integration.category} does not support ${input.mode}.`,
      );
    }

    const resolved = this.registry.resolve(integration.category, integration.provider);
    const capability = input.mode === 'PULL_SYNC' ? resolved.pullSync : resolved.pushSync;
    if (!capability) {
      throw new BadRequestException(
        `Provider "${integration.provider}" does not implement ${input.mode}.`,
      );
    }

    const run = await this.integrationsService.tenantClient.integrationSyncRun.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        direction: input.mode === 'PULL_SYNC' ? 'INBOUND' : 'OUTBOUND',
        status: 'PENDING',
        trigger: input.trigger,
        // entityType and pageSize live in scope rather than in dedicated columns: they are per-run
        // inputs that vary by request, and a column each would imply a fixed sync shape per
        // integration, which is exactly the vendor coupling this framework exists to avoid.
        scope: {
          entityType: input.entityType,
          ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
          ...(input.scope ?? {}),
        } as Prisma.InputJsonValue,
        // Snapshot the integration's stored cursor as the starting point. This is what makes a
        // RESUMED run resume rather than silently re-reading the provider from the beginning.
        cursorBefore: integration.syncCursor,
        requestedBy: input.requestedBy ?? null,
      },
    });

    await this.queue.add(
      'run',
      {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        syncRunId: run.id,
        entityType: input.entityType,
        mode: input.mode,
      },
      { attempts: 1, removeOnComplete: 1_000, removeOnFail: 5_000, jobId: `integration-sync-run:${run.id}` },
    );

    return run;
  }

  /**
   * Marks a not-yet-finished run cancelled.
   *
   * A run that is already terminal is returned unchanged rather than overwritten: cancelling a run
   * that already SUCCEEDED would rewrite history, and cancelling a FAILED one would erase the
   * evidence an operator is triaging.
   */
  async cancelRun(runId: string) {
    const run = await this.integrationsService.tenantClient.integrationSyncRun.findFirst({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Sync run not found.');
    }
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED' || run.status === 'CANCELED') {
      return { previousStatus: run.status, canceled: false, run };
    }

    // The processor re-reads the run's status before each page, so it observes this within one page
    // rather than after the whole run finishes.
    const updated = await this.integrationsService.tenantClient.integrationSyncRun.update({
      where: { id: runId },
      data: { status: 'CANCELED', finishedAt: new Date() },
    });
    return { previousStatus: run.status, canceled: true, run: updated };
  }
}