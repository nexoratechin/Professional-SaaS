import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  buildCertificatePdf,
  certificateTitle,
  type CertificateBranding,
  type CertificatePdfField,
  type CertificatePdfInput,
  type MarkSheetTable,
} from '@college-erp/certificates';
import { createTenantScopedClient, type GeneratedDocument } from '@college-erp/database';
import { requireTenantId } from '@college-erp/queue';
import { QUEUE_NAMES, type PdfGenerationJobData } from '@college-erp/types';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

/**
 * Generic async PDF renderer backed by the tenant-owned GeneratedDocument row.
 *
 * Renderers are keyed by `kind`:
 *  - CERTIFICATE — re-renders a certificate from its frozen `contentJson` snapshot (storage-loss
 *    recovery) and re-points the certificate's storageKey at the fresh artifact.
 *  - TEXT        — a title + label/value fields document (letters, statements, notices).
 *
 * Status moves QUEUED → ACTIVE → COMPLETED/FAILED on the row so a client can poll it; a duplicate
 * delivery after COMPLETED is a no-op.
 */
@Processor(QUEUE_NAMES.PDF_GENERATION)
export class PdfGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfGenerationProcessor.name);

  constructor(private readonly storage: WorkerStorageService) {
    super();
  }

  async process(job: Job<PdfGenerationJobData>): Promise<void> {
    const tenantId = requireTenantId(job);
    const db = createTenantScopedClient(tenantId);
    const document = await db.generatedDocument.findFirst({ where: { id: job.data.generatedDocumentId } });
    if (!document) {
      throw new UnrecoverableError(`GeneratedDocument ${job.data.generatedDocumentId} not found for tenant ${tenantId}.`);
    }
    if (document.status === 'COMPLETED') return;

    await db.generatedDocument.updateMany({ where: { id: document.id }, data: { status: 'ACTIVE' } });

    try {
      const pdf = await this.render(tenantId, document);
      const storageKey = `tenants/${tenantId}/generated/${document.id}.pdf`;
      await this.storage.uploadBuffer(tenantId, storageKey, pdf, 'application/pdf');
      await db.generatedDocument.updateMany({
        where: { id: document.id },
        data: {
          status: 'COMPLETED',
          storageKey,
          contentType: 'application/pdf',
          byteSize: pdf.length,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      this.logger.log(`Rendered GeneratedDocument ${document.id} (${document.kind}) -> ${storageKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF generation failed.';
      await db.generatedDocument.updateMany({
        where: { id: document.id },
        data: { status: 'FAILED', errorMessage: message.slice(0, 500) },
      });
      if (error instanceof UnrecoverableError) throw error;
      throw error;
    }
  }

  private async render(tenantId: string, document: GeneratedDocument): Promise<Buffer> {
    switch (document.kind) {
      case 'CERTIFICATE':
        return this.renderCertificate(tenantId, document);
      case 'TEXT':
        return renderText(document);
      default:
        throw new UnrecoverableError(`Unknown GeneratedDocument kind: ${document.kind}`);
    }
  }

  private async renderCertificate(tenantId: string, document: GeneratedDocument): Promise<Buffer> {
    const input = (document.input ?? {}) as { certificateId?: string };
    if (!input.certificateId) {
      throw new UnrecoverableError('CERTIFICATE render input is missing certificateId.');
    }
    const db = createTenantScopedClient(tenantId);
    const certificate = await db.studentCertificate.findFirst({ where: { id: input.certificateId, tenantId } });
    if (!certificate || !certificate.certificateNumber) {
      throw new UnrecoverableError('Certificate not found or has no allocated number.');
    }
    const snapshot = (certificate.contentJson ?? {}) as Record<string, unknown>;
    const pdf = buildCertificatePdf({
      title: certificate.title ?? certificateTitle(certificate.certificateType),
      certificateNumber: certificate.certificateNumber,
      issuedTo: String(snapshot.issuedTo ?? ''),
      branding: (snapshot.branding ?? {}) as CertificateBranding,
      fields: (snapshot.fields ?? []) as CertificatePdfField[],
      table: (snapshot.table ?? undefined) as MarkSheetTable | undefined,
      summary: (snapshot.summary ?? undefined) as CertificatePdfField[] | undefined,
      issuedDate: certificate.issuedAt ? certificate.issuedAt.toISOString().slice(0, 10) : null,
      verifyUrl: (snapshot.verifyUrl as string | null) ?? null,
      qrEnabled: Boolean(snapshot.verifyUrl),
    });
    await db.studentCertificate.update({ where: { id: certificate.id }, data: { storageKey: `tenants/${tenantId}/certificates/${certificate.certificateNumber}.pdf` } });
    return pdf;
  }
}

function renderText(document: GeneratedDocument): Buffer {
  const input = (document.input ?? {}) as {
    title?: string;
    issuedTo?: string;
    fields?: CertificatePdfField[];
    branding?: CertificateBranding;
  };
  const pdfInput: CertificatePdfInput = {
    title: input.title ?? document.title ?? 'Document',
    certificateNumber: document.id.slice(0, 12).toUpperCase(),
    issuedTo: input.issuedTo ?? '',
    branding: input.branding ?? {},
    fields: input.fields ?? [],
    issuedDate: null,
    verifyUrl: null,
    qrEnabled: false,
  };
  return buildCertificatePdf(pdfInput);
}
