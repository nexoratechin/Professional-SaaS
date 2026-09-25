import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import type { DocumentVirusScanJobData } from '@college-erp/types';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';
import { createVirusScanner } from './scanners/scanner.factory';
import type { VirusScanner } from './scanners/scanner.interface';

/**
 * Consumes the `document-virus-scan` queue (enqueued by the API on every confirm-upload /
 * confirm-version-upload) and runs the single worker instance through the configured scanner:
 *
 *   clean     → version SCANNING → CLEAN (scanEngine + scannedAt), document → READY
 *   infected  → version → QUARANTINED (threat recorded), storage object DELETED, document → QUARANTINED
 *   error     → version → ERROR (scanError kept for retries), document stays AWAITING_SCAN/UPLOADED;
 *               the error is rethrown so BullMQ retries with the API's attempts/backoff
 *
 * All DB mutations run through the tenant-scoped client built from the job payload; the audit
 * trail goes through the unscoped platform client with actorType SYSTEM (no HTTP actor exists).
 * Idempotent by design: versions already CLEAN/INFECTED/QUARANTINED are skipped.
 */
@Processor(QUEUE_NAMES.DOCUMENT_VIRUS_SCAN)
export class DocumentVirusScanProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentVirusScanProcessor.name);
  private readonly scanner: VirusScanner;

  constructor(
    private readonly storage: WorkerStorageService,
    appConfig: AppConfigService,
  ) {
    super();
    // Built once at boot — a bad VIRUS_SCAN_PROVIDER config fails fast on startup, not mid-job.
    this.scanner = createVirusScanner(appConfig, storage);
  }

  async process(job: Job<DocumentVirusScanJobData>): Promise<void> {
    const { tenantId, documentId, versionId } = job.data;
    const client = createTenantScopedClient(tenantId);

    const version = await client.documentVersion.findFirst({ where: { id: versionId, documentId } });
    if (!version || version.deletedAt) {
      this.logger.warn(`Scan job ${job.id}: version ${versionId} not found — skipping.`);
      return;
    }
    if (version.scanStatus === 'CLEAN' || version.scanStatus === 'INFECTED' || version.scanStatus === 'QUARANTINED') {
      this.logger.log(`Scan job ${job.id}: version ${versionId} already ${version.scanStatus} — skipping.`);
      return;
    }

    await client.documentVersion.update({
      where: { id: version.id },
      data: { scanStatus: 'SCANNING', scanError: null },
    });

    try {
      const result = await this.scanner.scan(tenantId, {
        storageKey: version.storageKey,
        originalFilename: version.originalFilename,
        mimeType: version.mimeType,
        sizeBytes: version.sizeBytes ?? 0,
      });

      if (result.clean) {
        await client.$transaction([
          client.documentVersion.update({
            where: { id: version.id },
            data: { scanStatus: 'CLEAN', scanEngine: result.engine, scannedAt: new Date() },
          }),
          // Only forward the document if it is still waiting on this scan (a REJECTED/EXPIRED
          // document stays terminal; a later replace doesn't resurrect an old version's job).
          client.document.updateMany({
            where: { id: documentId, status: { in: ['AWAITING_SCAN', 'UPLOADED'] } },
            data: { status: 'READY' },
          }),
        ]);

        await this.writeAudit(tenantId, documentId, versionId, AUDIT_ACTIONS.DOCUMENT_VIRUS_CLEAN, {
          engine: result.engine,
        });
        this.logger.log(`Version ${versionId} scanned clean with ${result.engine}.`);
        return;
      }

      // Infected: quarantine the version and remove the payload from storage.
      await this.storage.deleteObject(tenantId, version.storageKey);
      await client.$transaction([
        client.documentVersion.update({
          where: { id: version.id },
          data: {
            scanStatus: 'QUARANTINED',
            scanEngine: result.engine,
            scanError: result.threatName ?? 'Malware signature detected',
            scannedAt: new Date(),
          },
        }),
        client.document.update({ where: { id: documentId }, data: { status: 'QUARANTINED' } }),
      ]);

      await this.writeAudit(tenantId, documentId, versionId, AUDIT_ACTIONS.DOCUMENT_VIRUS_INFECTED, {
        threatName: result.threatName ?? 'Unknown signature',
        engine: result.engine,
      });
      this.logger.warn(`Version ${versionId} QUARANTINED (${result.threatName ?? 'unknown threat'}); object deleted.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.documentVersion.update({
        where: { id: version.id },
        data: { scanStatus: 'ERROR', scanError: message, scannedAt: new Date() },
      });

      await this.writeAudit(tenantId, documentId, versionId, AUDIT_ACTIONS.DOCUMENT_SCAN_ERROR, { error: message });
      this.logger.error(`Scan failed for version ${versionId}, marking ERROR and retrying: ${message}`);
      throw err; // Let BullMQ apply the queue's attempts/backoff.
    }
  }

  private async writeAudit(
    tenantId: string,
    documentId: string,
    versionId: string,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await platformPrismaClient.platformAuditLog.create({
      data: {
        scope: 'TENANT',
        tenantId,
        actorType: 'SYSTEM',
        action,
        module: AUDIT_MODULES.DOCUMENTS,
        entityType: 'DocumentVersion',
        entityId: versionId,
        after: { ...after, documentId },
      },
    });
  }
}