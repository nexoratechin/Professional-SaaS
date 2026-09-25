import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import type { DocumentRetentionSweepJobData } from '@college-erp/types';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lifecycle states a document can still be swept into EXPIRED by retention. Terminal states
 *  (EXPIRED/REJECTED/QUARANTINED) and transient REPLACED are left alone. */
const SWEEPABLE_STATUSES = ['PENDING_UPLOAD', 'UPLOADED', 'AWAITING_SCAN', 'READY', 'VERIFIED'] as const;

/**
 * Cross-tenant maintenance sweep (repeatable job registered by DocumentRetentionSchedulerService):
 * finds every document past its retention window — explicit `expiresAt`, or its DocumentType's
 * `retentionDays` measured from creation — and expires it: deletes the current version's storage
 * object, flips the document to EXPIRED, and writes the DOCUMENT_RETENTION_EXPIRED audit entry.
 *
 * Like the other sweeps this reads through the unscoped platform client to FIND candidates, then
 * mutates each tenant's rows through a tenant-scoped client built per tenantId. Reads are
 * evaluated in JS (retentionDays math) so the query stays index-friendly on tenantId/status.
 */
@Processor(QUEUE_NAMES.DOCUMENT_RETENTION)
export class DocumentRetentionSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentRetentionSweepProcessor.name);

  constructor(private readonly storage: WorkerStorageService) {
    super();
  }

  async process(_job: Job<DocumentRetentionSweepJobData>): Promise<void> {
    const now = new Date();

    const candidates = await platformPrismaClient.document.findMany({
      where: {
        deletedAt: null,
        status: { in: [...SWEEPABLE_STATUSES] },
        OR: [
          { expiresAt: { lte: now } },
          { documentType: { retentionDays: { not: null } } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        documentType: { select: { retentionDays: true } },
        currentVersion: { select: { storageKey: true } },
      },
    });

    const due = candidates.filter((doc) => {
      if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) return true;
      const retentionDays = doc.documentType?.retentionDays;
      if (!retentionDays) return false;
      const windowEnd = doc.createdAt.getTime() + retentionDays * DAY_MS;
      return windowEnd <= now.getTime();
    });

    const byTenant = new Map<string, (typeof due)[number][]>();
    for (const doc of due) {
      const list = byTenant.get(doc.tenantId) ?? [];
      list.push(doc);
      byTenant.set(doc.tenantId, list);
    }

    let expired = 0;
    for (const [tenantId, docs] of byTenant) {
      const tenantClient = createTenantScopedClient(tenantId);

      for (const doc of docs) {
        if (doc.currentVersion?.storageKey) {
          await this.storage.deleteObject(tenantId, doc.currentVersion.storageKey);
        }

        await tenantClient.document.update({
          where: { id: doc.id },
          data: { status: 'EXPIRED', expiredAt: now },
        });

        await platformPrismaClient.platformAuditLog.create({
          data: {
            scope: 'TENANT',
            tenantId,
            actorType: 'SYSTEM',
            action: AUDIT_ACTIONS.DOCUMENT_RETENTION_EXPIRED,
            module: AUDIT_MODULES.DOCUMENTS,
            entityType: 'Document',
            entityId: doc.id,
            after: {
              title: doc.title,
              reason: doc.expiresAt && doc.expiresAt.getTime() <= now.getTime() ? 'expires_at' : 'retention_days',
            },
          },
        });

        expired += 1;
      }
    }

    this.logger.log(
      `Document retention sweep: ${candidates.length} candidate(s) found, ${due.length} due, expired ${expired} across ${byTenant.size} tenant(s).`,
    );
  }
}