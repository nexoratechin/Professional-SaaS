/**
 * Document classification queue: enqueue, list, review.
 *
 * The processing itself (OCR + classification) lives in the worker, because a 200-page PDF handed to a
 * synchronous HTTP request is a timeout waiting to happen. This service owns the API half:
 *
 *  - **enqueue** a version for classification, on its way in or later by hand;
 *  - **list** the queue, with `extractedText` withheld unless the caller also holds `documents.read`
 *    on the owning document;
 *  - **review** a machine suggestion, which is the only way a suggestion becomes authoritative.
 *
 * ## The trust model, which is the interesting part
 *
 * A classifier's output is a *guess*. So this module keeps two columns apart and never confuses them:
 * `suggestedCategory`/`confidence` (what the machine said) and `confirmedCategory`/`reviewedBy` (what a
 * human decided). Downstream consumers read the confirmed value only. If a re-run overwrites a
 * suggestion, a confirmed row is untouched — the review endpoint sets `skipIfReviewed` on the
 * re-enqueued job precisely so that a retry cannot quietly undo a human decision.
 *
 * And `extractedText` is PII. A document's text may contain a student's name, DOB, or guardian
 * address, so it is returned only to a caller who independently holds `documents.read`; holding
 * `ai.view` alone is not enough, because `ai.view` is a permission to *ask questions*, not to read
 * every file in the tenant.
 */

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { AiDocumentClassificationStatus, Prisma } from '@college-erp/database';
import { QUEUE_NAMES, type AiDocumentProcessingJobData } from '@college-erp/types';
import type { AiDocumentClassificationDto, AiDocumentClassificationListDto, AiDocumentClassificationStatusDto } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import type {
  ListAiDocumentClassificationsDto,
  QueueAiDocumentClassificationDto,
  ReviewAiDocumentClassificationDto,
} from './dto/ai-assistant.dto';

/**
 * Statuses that mean "a human has made a call on this row".
 *
 * Typed as the Prisma enum rather than as the wire DTO so the same literals can be handed straight
 * to a `where` clause — the two types are structurally the same set of strings, and casting at the
 * query boundary is where a review-queue filter would otherwise be silently wrong.
 */
const REVIEWED_STATUSES: AiDocumentClassificationStatus[] = [
  AiDocumentClassificationStatus.CONFIRMED,
  AiDocumentClassificationStatus.CORRECTED,
  AiDocumentClassificationStatus.FAILED,
];

/** The projection every classification read uses — deliberately minimal, then widened per row. */
const CLASSIFICATION_SELECT = {
  id: true,
  documentId: true,
  documentVersionId: true,
  suggestedCategory: true,
  suggestedTypeId: true,
  confidence: true,
  extractedText: true,
  extractedFields: true,
  status: true,
  confirmedTypeId: true,
  confirmedCategory: true,
  reviewedBy: true,
  reviewedAt: true,
  reviewNote: true,
  provider: true,
  model: true,
  errorMessage: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
  document: { select: { title: true } },
  documentVersion: { select: { originalFilename: true, mimeType: true } },
} as const;

type ClassificationRow = {
  id: string;
  documentId: string;
  documentVersionId: string;
  suggestedCategory: string | null;
  suggestedTypeId: string | null;
  confidence: number | null;
  extractedText: string | null;
  extractedFields: Prisma.JsonValue;
  status: string;
  confirmedTypeId: string | null;
  confirmedCategory: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  provider: string | null;
  model: string | null;
  errorMessage: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  document: { title: string };
  documentVersion: { originalFilename: string; mimeType: string | null };
};

@Injectable()
export class AiDocumentClassificationService {
  private readonly logger = new Logger(AiDocumentClassificationService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly appConfig: AppConfigService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.AI_DOCUMENT_PROCESSING)
    private readonly processingQueue: Queue<AiDocumentProcessingJobData>,
  ) {}

  /**
   * Queues one document version for classification.
   *
   * The version must belong to the document (checked here, not assumed by the worker) and must be
   * `scanStatus: CLEAN`. Classifying an unscanned object would mean running OCR over a file the
   * platform has not established is safe — so the virus scan genuinely gates this, rather than being
   * an incidental ordering preference.
   */
  async queue(user: AuthenticatedUser, dto: QueueAiDocumentClassificationDto) {
    if (!this.appConfig.get('AI_ENABLED')) {
      throw new ForbiddenException('The AI assistant is disabled for this deployment.');
    }

    const version = await this.tenantPrisma.client.documentVersion.findFirst({
      where: { id: dto.versionId, documentId: dto.documentId },
      select: {
        id: true,
        documentId: true,
        scanStatus: true,
        deletedAt: true,
        mimeType: true,
        document: { select: { deletedAt: true, title: true } },
      },
    });
    if (!version || version.deletedAt || version.document.deletedAt) {
      throw new NotFoundException('Document version not found.');
    }
    if (version.scanStatus !== 'CLEAN') {
      throw new ForbiddenException(
        'This document version has not cleared the virus scan yet; classification waits until it does.',
      );
    }

    // Upsert on (tenantId, documentVersionId): one row per version is the schema's contract, and
    // re-classifying a version must replace the previous guess rather than accumulate guesses.
    //
    // The `update` branch deliberately omits `confirmedTypeId`/`confirmedCategory`/`reviewedBy`. A new
    // machine attempt refreshes what the machine said and leaves the human decision alone — otherwise
    // re-running classification would quietly discard a reviewer's correction.
    await this.untypedCreate().aiDocumentClassification.upsert({
      where: { tenantId_documentVersionId: { tenantId: user.tenantId, documentVersionId: version.id } },
      create: {
        documentId: version.documentId,
        documentVersionId: version.id,
        status: 'PENDING',
      },
      update: {
        status: 'PENDING',
        errorMessage: null,
        processedAt: null,
        suggestedCategory: null,
        suggestedTypeId: null,
        confidence: null,
        extractedText: null,
        extractedFields: Prisma.JsonNull,
        provider: null,
        model: null,
      },
    });

    await this.enqueue(user.tenantId, version.documentId, version.id, {
      steps: dto.includeOcr === false ? ['CLASSIFY'] : ['CLASSIFY', 'OCR'],
      // A re-run of an already-reviewed version must not undo the human's decision.
      skipIfReviewed: true,
    });

    // Audited regardless of whether the enqueue reached Redis: the row is now PENDING, so the fact
    // that a human asked for it is true either way, and a queue outage should not erase the request.
    await this.recordQueued(user, version.documentId, version.id);

    return {
      queued: true,
      documentId: version.documentId,
      versionId: version.id,
      mimeType: version.mimeType,
      message: 'Queued for AI classification.',
    };
  }

  /**
   * The review queue.
   *
   * `extractedText` is included only for callers who also hold `documents.read`. That check is
   * resolved **once** for the whole page (it is a module-wide permission, not a per-document one) and
   * then applied per row, so a mixed page can never leak one document's text to a caller who could
   * not read that document.
   */
  async list(
    user: AuthenticatedUser,
    dto: ListAiDocumentClassificationsDto,
  ): Promise<AiDocumentClassificationListDto> {
    const skip = dto.skip ?? 0;
    const take = Math.min(dto.take ?? 20, 100);

    const where: Prisma.AiDocumentClassificationWhereInput = {
      ...(dto.status ? { status: dto.status as AiDocumentClassificationStatus } : {}),
      ...(dto.unreviewedOnly ? { status: { notIn: REVIEWED_STATUSES } } : {}),
    };

    const [rows, total, canReadDocuments] = await Promise.all([
      this.tenantPrisma.client.aiDocumentClassification.findMany({
        where,
        select: CLASSIFICATION_SELECT,
        // Oldest first: the review queue's value is clearing the backlog, and newest-first would
        // starve exactly the rows that have waited longest.
        orderBy: [{ createdAt: 'asc' }],
        skip,
        take,
      }),
      this.tenantPrisma.client.aiDocumentClassification.count({ where }),
      this.canReadDocuments(user),
    ]);

    return {
      data: rows.map((row) => this.toDto(row as ClassificationRow, canReadDocuments)),
      total,
      skip,
      take,
    };
  }

  /**
   * Records a human decision on a classification.
   *
   * CONFIRM accepts the machine's suggestion as-is; CORRECT overrides it with the supplied type or
   * category; REJECT records "this classification is wrong, fix the pipeline", which is the only way
   * a systematic mis-classification becomes visible instead of being silently corrected one row at a
   * time by users who never look at a queue.
   */
  async review(
    user: AuthenticatedUser,
    id: string,
    dto: ReviewAiDocumentClassificationDto,
  ): Promise<AiDocumentClassificationDto> {
    const row = await this.tenantPrisma.client.aiDocumentClassification.findFirst({
      where: { id },
      select: CLASSIFICATION_SELECT,
    });
    if (!row) throw new NotFoundException('Classification not found.');

    if (dto.decision === 'REJECT') {
      await this.tenantPrisma.client.aiDocumentClassification.update({
        where: { id },
        data: { status: 'FAILED', reviewedBy: user.id, reviewedAt: new Date(), reviewNote: dto.note ?? 'Rejected by reviewer.' },
      });
    } else if (dto.decision === 'CONFIRM') {
      await this.tenantPrisma.client.aiDocumentClassification.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedTypeId: row.suggestedTypeId,
          confirmedCategory: row.suggestedCategory,
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNote: dto.note,
        },
      });
    } else {
      if (!dto.documentTypeId && !dto.category) {
        throw new ForbiddenException('A correction needs either documentTypeId or category.');
      }
      await this.tenantPrisma.client.aiDocumentClassification.update({
        where: { id },
        data: {
          status: 'CORRECTED',
          confirmedTypeId: dto.documentTypeId ?? row.suggestedTypeId,
          confirmedCategory: dto.category ?? row.suggestedCategory,
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNote: dto.note,
        },
      });
    }

    const updated = await this.tenantPrisma.client.aiDocumentClassification.findUniqueOrThrow({
      where: { id },
      select: CLASSIFICATION_SELECT,
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_DOCUMENT_CLASSIFICATION_REVIEWED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiDocumentClassification',
      entityId: id,
      // Before/after on the *decision* only — never the extracted text, which is the PII this whole
      // check exists to keep out of places that outlive the document.
      before: { status: row.status, confirmedTypeId: row.confirmedTypeId, confirmedCategory: row.confirmedCategory },
      after: { status: dto.decision, documentTypeId: dto.documentTypeId, category: dto.category },
    });

    return this.toDto(updated as ClassificationRow, await this.canReadDocuments(user));
  }

  async recordQueued(user: AuthenticatedUser, documentId: string, versionId: string): Promise<void> {
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_DOCUMENT_CLASSIFIED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiDocumentClassification',
      entityId: versionId,
      after: { documentId, queued: true },
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private toDto(row: ClassificationRow, canReadDocuments: boolean): AiDocumentClassificationDto {
    return {
      id: row.id,
      documentId: row.documentId,
      documentTitle: row.document.title,
      documentVersionId: row.documentVersionId,
      originalFilename: row.documentVersion.originalFilename,
      mimeType: row.documentVersion.mimeType,
      status: row.status as AiDocumentClassificationStatusDto,
      suggestedCategory: row.suggestedCategory,
      suggestedDocumentTypeId: row.suggestedTypeId,
      confidence: row.confidence,
      // Withheld rather than merely hidden in the UI: a caller without documents.read has no business
      // receiving a student's name and DOB inside a classification response.
      extractedText: canReadDocuments ? row.extractedText : null,
      extractedFields: canReadDocuments ? (row.extractedFields as Record<string, unknown> | null) : null,
      confirmedCategory: row.confirmedCategory,
      confirmedDocumentTypeId: row.confirmedTypeId,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      reviewNote: row.reviewNote,
      provider: row.provider,
      model: row.model,
      errorMessage: row.errorMessage,
      processedAt: row.processedAt ? row.processedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async canReadDocuments(user: AuthenticatedUser): Promise<boolean> {
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    return Boolean(effective[PERMISSION_KEYS.DOCUMENTS_VIEW]?.length);
  }

  /**
   * Enqueues without failing the request when the queue is down.
   *
   * Classification is an enrichment, not a correctness requirement: the document is already stored,
   * scanned and verified without it. A row left at PENDING is visible in the review queue and can be
   * re-queued, which is a better outcome than refusing an otherwise-valid operation.
   */
  private async enqueue(
    tenantId: string,
    documentId: string,
    versionId: string,
    options: { steps: Array<'CLASSIFY' | 'OCR'>; skipIfReviewed?: boolean },
  ): Promise<boolean> {
    try {
      await this.processingQueue.add(
        'process',
        { tenantId, documentId, versionId, steps: options.steps, skipIfReviewed: options.skipIfReviewed },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
      );
      return true;
    } catch (err) {
      this.logger.error(`Failed to enqueue AI classification for version ${versionId}: ${String(err)}`);
      return false;
    }
  }

  /**
   * The tenant-scope extension injects `tenantId` at runtime while the generated create-input still
   * demands it at compile time. One cast, confined here — the same reason ReportsService has one.
   */
  private untypedCreate(): UntypedCreateClient {
    return this.tenantPrisma.client as unknown as UntypedCreateClient;
  }
}

interface UntypedCreateClient {
  aiDocumentClassification: {
    upsert(args: {
      where: { tenantId_documentVersionId: { tenantId: string; documentVersionId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
}