/**
 * Consumes the `ai-document-processing` queue: OCR (when configured) and classification for one
 * already-scanned `DocumentVersion`.
 *
 * ## The two safety properties this processor is built around
 *
 *  1. **The virus scan genuinely gates it.** The API refuses to enqueue a version that is not
 *     `scanStatus: CLEAN`, but the job can outlive that decision — a re-scan can quarantine a file
 *     between enqueue and execution. So the processor re-reads the version through a tenant-scoped
 *     client built from the job's `tenantId`, and *returns without touching anything* unless the
 *     version and its document are both alive and still `CLEAN`. The job payload carries ids only;
 *     it never carries a storage key, so a tampered payload cannot be turned into a read of another
 *     tenant's object.
 *
 *  2. **A machine guess is never mistaken for a human decision.** The processor writes only the
 *     `suggested*` fields plus the extraction. `confirmed*`/`reviewedBy` stay exclusively the
 *     review endpoint's. The one exception is auto-accept: above `AI_AUTO_ACCEPT_CONFIDENCE` the
 *     suggestion is promoted into `confirmed*` so downstream consumers have an effective value —
 *     but `reviewedBy` is deliberately left null, which is what distinguishes "the machine was
 *     confident" from "a human signed off". Nothing here touches the *document's* `documentTypeId`,
 *     so even a wrong auto-accept cannot silently re-file a document.
 *
 * ## Why failure is not a disaster
 *
 * Classification is an enrichment, not a correctness requirement: the document is already stored,
 * scanned and verified without it. A failure marks the row `ERROR` with the reason and rethrows so
 * BullMQ retries; a version with no OCR configured is marked `NO_TEXT` rather than failed. Enabling
 * a provider later and re-queueing the row is the recovery path, which is why the row survives.
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient, Prisma, type AiDocumentClassificationStatus } from '@college-erp/database';
import { processorOptions } from '@college-erp/queue';
import { QUEUE_NAMES, type AiDocumentProcessingJobData } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';
import { classifyDocument, extractStructuredFields, type ClassificationTypeOption } from './ai-document-classifier';

/** Statuses that mean a human (or a prior terminal run) has had the last word on this row. */
const REVIEWED_STATUSES: AiDocumentClassificationStatus[] = ['CONFIRMED', 'CORRECTED', 'FAILED'];

/**
 * Largest object handed to the OCR endpoint in one request.
 *
 * Deliberately below the global 25 MiB upload cap: base64 inflates the payload by a third, and an
 * OCR provider that receives a 30 MiB request tends to fail at the HTTP layer rather than return a
 * useful error. Oversized files are classified from their filename/title instead, which is exactly
 * what the classifier is designed to do without any text.
 */
const MAX_OCR_INPUT_BYTES = 15 * 1024 * 1024;

const OCR_REQUEST_TIMEOUT_MS = 60_000;

@Processor(QUEUE_NAMES.AI_DOCUMENT_PROCESSING, processorOptions(QUEUE_NAMES.AI_DOCUMENT_PROCESSING))
export class AiDocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiDocumentProcessingProcessor.name);

  constructor(
    private readonly storage: WorkerStorageService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  async process(job: Job<AiDocumentProcessingJobData>): Promise<void> {
    const { tenantId, documentId, versionId, steps, skipIfReviewed } = job.data;

    // Master switch: when the deployment has AI turned off, leave the row PENDING rather than
    // burning it. Turning AI on later picks the backlog up with a re-queue, whereas marking it
    // ERROR here would require a human to notice and fix rows that were never actually wrong.
    if (!this.config.get('AI_ENABLED')) {
      this.logger.log(`AI job ${job.id}: AI_ENABLED is off — leaving version ${versionId} untouched.`);
      return;
    }

    const client = createTenantScopedClient(tenantId);

    // 1. Re-establish what this job is allowed to touch, from scratch.
    const version = await client.documentVersion.findFirst({
      where: { id: versionId, documentId },
      select: {
        id: true,
        storageKey: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        scanStatus: true,
        deletedAt: true,
        document: { select: { id: true, title: true, deletedAt: true } },
      },
    });
    if (!version || version.deletedAt || version.document.deletedAt) {
      this.logger.warn(`AI job ${job.id}: version ${versionId} not found or deleted — skipping.`);
      return;
    }
    if (version.scanStatus !== 'CLEAN') {
      this.logger.warn(`AI job ${job.id}: version ${versionId} is ${version.scanStatus}, not CLEAN — skipping.`);
      return;
    }

    const classification = await client.aiDocumentClassification.findFirst({
      where: { documentVersionId: versionId },
      select: { id: true, status: true, confirmedTypeId: true, confirmedCategory: true },
    });
    if (!classification) {
      this.logger.warn(`AI job ${job.id}: no classification row for version ${versionId} — skipping.`);
      return;
    }
    if (skipIfReviewed && REVIEWED_STATUSES.includes(classification.status)) {
      this.logger.log(`AI job ${job.id}: version ${versionId} is already ${classification.status} — not overwriting a review.`);
      return;
    }

    try {
      // 2. Text extraction (optional). Absence of an OCR endpoint is a supported configuration, not
      //    an error: classification falls back to the filename/title it was always designed to use.
      let extractedText: string | null = null;
      let ocrRan = false;
      if (steps.includes('OCR')) {
        try {
          extractedText = await this.extractText(tenantId, version.storageKey, version.originalFilename, version.mimeType, version.sizeBytes ?? 0);
          ocrRan = extractedText !== null;
        } catch (err) {
          // Best-effort: a provider outage degrades the classification, it does not fail the job.
          this.logger.warn(`AI job ${job.id}: OCR failed for version ${versionId}, classifying without text: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Classify. The tenant's own types first; a built-in label only if none matches.
      const types = await client.documentType.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, code: true, name: true },
      });
      const outcome = classifyDocument(
        {
          originalFilename: version.originalFilename,
          documentTitle: version.document.title,
          mimeType: version.mimeType,
          text: extractedText ?? '',
        },
        types as ClassificationTypeOption[],
      );

      const structured = extractedText ? extractStructuredFields(extractedText) : null;
      // `NO_TEXT` means "we had nothing to work with": no extracted text and no label matched
      // either. If either signal exists, the row is `CLASSIFIED` and a reviewer can act on it.
      const status: AiDocumentClassificationStatus =
        extractedText === null && outcome.suggestedCategory === null ? 'NO_TEXT' : 'CLASSIFIED';

      const autoAccept =
        outcome.suggestedCategory !== null &&
        outcome.confidence >= this.config.get('AI_AUTO_ACCEPT_CONFIDENCE') &&
        // Never overwrite a confirmed value that is already there. `skipIfReviewed` already guards
        // the reviewed statuses; this guards the case where a prior auto-accept left `confirmed*`
        // populated on a row that is still CLASSIFIED.
        classification.confirmedTypeId === null &&
        classification.confirmedCategory === null;

      await client.aiDocumentClassification.update({
        where: { id: classification.id },
        data: {
          status,
          suggestedCategory: outcome.suggestedCategory,
          suggestedTypeId: outcome.suggestedTypeId,
          confidence: outcome.suggestedCategory !== null || extractedText !== null ? outcome.confidence : null,
          extractedText,
          // `Prisma.JsonNull` because an absent extraction must be a JSON `null`, not SQL NULL —
          // the column is nullable JSONB and the client distinguishes the two.
          extractedFields: (structured as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
          provider: ocrRan ? 'ocr' : null,
          model: null,
          errorMessage: null,
          processedAt: new Date(),
          // Auto-accept fills the *effective* value but not `reviewedBy`: downstream can tell a
          // confident machine from a human, and the review endpoint can still override either.
          ...(autoAccept ? { confirmedTypeId: outcome.suggestedTypeId, confirmedCategory: outcome.suggestedCategory } : {}),
        },
      });

      // 4. Audit. Two separate actions because they are two separate claims: "we read the file's
      //    contents" and "we decided what it is". The text itself is never copied into the log.
      if (ocrRan) {
        await this.writeAudit(tenantId, documentId, versionId, AUDIT_ACTIONS.AI_DOCUMENT_OCR_EXTRACTED, {
          characters: extractedText?.length ?? 0,
          fieldGroups: structured ? Object.keys(structured) : [],
        });
      }
      await this.writeAudit(tenantId, documentId, versionId, AUDIT_ACTIONS.AI_DOCUMENT_CLASSIFIED, {
        status,
        suggestedCategory: outcome.suggestedCategory,
        suggestedTypeId: outcome.suggestedTypeId,
        confidence: outcome.confidence,
        autoAccepted: autoAccept,
      });

      this.logger.log(
        `AI job ${job.id}: version ${versionId} → ${status}${outcome.suggestedCategory ? ` (${outcome.suggestedCategory} @ ${outcome.confidence})` : ''}${autoAccept ? ' [auto-accepted]' : ''}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.aiDocumentClassification.update({
        where: { id: classification.id },
        data: { status: 'ERROR', errorMessage: message, processedAt: new Date() },
      });
      this.logger.error(`AI job ${job.id}: classification failed for version ${versionId}, marking ERROR and retrying: ${message}`);
      throw err; // Let BullMQ apply the queue's attempts/backoff.
    }
  }

  // ── OCR ───────────────────────────────────────────────────────────────────

  /**
   * Reads the object and asks the configured OCR endpoint for its text.
   *
   * Returns null — never throws for a *configuration* reason — when no endpoint is configured or
   * the object is too large to send, because both are normal states the classifier already handles.
   * A genuine provider error is thrown and caught by the caller, which degrades to classifying
   * without text rather than failing the job.
   */
  private async extractText(
    tenantId: string,
    storageKey: string,
    originalFilename: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<string | null> {
    const url = this.config.get('AI_OCR_API_URL');
    if (!url) return null;

    if (sizeBytes > MAX_OCR_INPUT_BYTES) {
      this.logger.warn(`OCR skipped for ${originalFilename}: ${sizeBytes} bytes exceeds the ${MAX_OCR_INPUT_BYTES}-byte OCR cap.`);
      return null;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of await this.storage.streamObject(tenantId, storageKey)) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_OCR_INPUT_BYTES) {
        this.logger.warn(`OCR skipped for ${originalFilename}: object grew past the OCR cap while streaming.`);
        return null;
      }
      chunks.push(buffer);
    }

    const apiKey = this.config.get('AI_OCR_API_KEY');
    const response = await this.postJson(
      url,
      { filename: originalFilename, mimeType, contentBase64: Buffer.concat(chunks).toString('base64') },
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    );

    const text = typeof response['text'] === 'string' ? response['text'] : '';
    const truncateAt = this.config.get('AI_MAX_EXTRACTED_TEXT_CHARS');
    const truncated = text.slice(0, truncateAt);
    return truncated.length > 0 ? truncated : null;
  }

  /** Bounded outbound call, mirroring the API provider's pattern (see ai-llm.provider.ts). */
  private async postJson(url: string, body: unknown, headers: Record<string, string>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Unscoped audit write with `actorType: SYSTEM` — there is no HTTP actor inside a job. */
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
        module: AUDIT_MODULES.AI,
        entityType: 'AiDocumentClassification',
        entityId: versionId,
        after: { ...after, documentId },
      },
    });
  }
}
