import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  generateCertificate,
  CertificateGenerationError,
  type CertificateGenerationDeps,
} from '@college-erp/certificates';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { requireTenantId } from '@college-erp/queue';
import { QUEUE_NAMES, type CertificateGenerationJobData } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

/**
 * Async certificate issuance. Runs the exact pipeline the API previously ran inline (via the
 * shared @college-erp/certificates package, so the two can never drift) but off the request path:
 * allocate the tenant-scoped number, snapshot the field/table/summary blocks, render the PDF,
 * upload it under the tenant prefix, and advance REQUESTED → GENERATED.
 *
 * Permanent domain failures (not found / wrong state / missing template) surface as
 * UnrecoverableError so BullMQ stops retrying and the queue-events bridge dead-letters them;
 * transient faults (storage, a concurrent-number clash) are rethrown to retry with backoff.
 *
 * A duplicate delivery after GENERATED is a no-op because generateCertificate short-circuits an
 * already-generated certificate (idempotent under BullMQ at-least-once).
 */
@Processor(QUEUE_NAMES.CERTIFICATE_GENERATION)
export class CertificateGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificateGenerationProcessor.name);

  constructor(
    private readonly storage: WorkerStorageService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  async process(job: Job<CertificateGenerationJobData>): Promise<void> {
    const tenantId = requireTenantId(job);
    const { certificateId, actorUserId, templateId } = job.data;
    const db = createTenantScopedClient(tenantId);

    try {
      const result = await generateCertificate(db, this.deps(), {
        tenantId,
        certificateId,
        actorUserId,
        templateId,
      });
      this.logger.log(
        `Generated certificate ${result.certificateNumber} (${certificateId}, tenant ${tenantId}) -> ${result.storageKey}`,
      );
    } catch (error) {
      if (error instanceof CertificateGenerationError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  private deps(): CertificateGenerationDeps {
    return {
      loadBrandingConfig: async (tenantId) => {
        const row = await platformPrismaClient.tenantConfiguration.findUnique({ where: { tenantId } });
        const data = (row?.data ?? {}) as Record<string, unknown>;
        return { branding: data.branding ?? null, numbering: data.numbering ?? null };
      },
      storageKeyFor: (tenantId, fileName) => `tenants/${tenantId}/certificates/${fileName}`,
      uploadPdf: (tenantId, key, buffer, contentType) => this.storage.uploadBuffer(tenantId, key, buffer, contentType),
      recordAudit: async (entry) => {
        await platformPrismaClient.platformAuditLog.create({
          data: {
            scope: 'TENANT',
            tenantId: entry.tenantId,
            actorType: entry.actorUserId ? 'USER' : 'SYSTEM',
            actorUserId: entry.actorUserId || null,
            action: entry.action,
            module: 'certificates',
            entityType: entry.entityType,
            entityId: entry.entityId,
            after: (entry.after ?? null) as never,
          },
        });
      },
      publicBaseUrl: this.config.get('PUBLIC_BASE_URL'),
    };
  }
}
