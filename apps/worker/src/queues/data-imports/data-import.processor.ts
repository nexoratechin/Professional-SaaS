import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
} from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import {
  autoMapHeaders,
  getImportEntity,
  parseTabularFile,
  validateRows,
  type ImportContext,
  type ImportEntityDefinition,
  type ImportFieldRef,
  type ImportFileFormat,
  type DuplicateStrategy,
  type ValidatedRow,
} from '@college-erp/imports';
import { QUEUE_NAMES, type DataImportJobData } from '@college-erp/types';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

type AnyClient = Record<string, any>;

interface ImportJobOptions {
  duplicateStrategy?: DuplicateStrategy;
  updateExisting?: boolean;
}

@Processor(QUEUE_NAMES.DATA_IMPORTS)
export class DataImportProcessor extends WorkerHost {
  private readonly logger = new Logger(DataImportProcessor.name);

  constructor(private readonly storage: WorkerStorageService) {
    super();
  }

  async process(job: Job<DataImportJobData>): Promise<void> {
    const { tenantId, jobId, rowNumbers } = job.data;
    const db = createTenantScopedClient(tenantId) as unknown as AnyClient;

    const importJob = await db.importJob.findFirst({ where: { id: jobId } });
    if (!importJob) {
      this.logger.warn(`Import job ${jobId} not found for tenant ${tenantId}; dropping.`);
      return;
    }
    if (importJob.status === 'COMPLETED' || importJob.status === 'CANCELLED' || importJob.status === 'VALIDATED') {
      this.logger.log(`Import job ${jobId} already ${importJob.status}; skipping.`);
      return;
    }

    const entity = getImportEntity(importJob.entityType);
    if (!entity) {
      await db.importJob.updateMany({ where: { id: jobId }, data: { status: 'FAILED', message: `Unknown entity ${importJob.entityType}`, completedAt: new Date() } });
      return;
    }

    await db.importJob.updateMany({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), completedAt: null, message: null },
    });

    try {
      const format = importJob.format as ImportFileFormat;
      const buffer = await this.storage.downloadBuffer(tenantId, importJob.storageKey);
      const parsed = parseTabularFile(buffer, format);
      const mapping = (importJob.mapping as Record<string, string> | null) ?? autoMapHeaders(entity, parsed.headers);
      const options: ImportJobOptions = (importJob.options as ImportJobOptions | null) ?? {};
      const duplicateStrategy: DuplicateStrategy = options.duplicateStrategy ?? 'SKIP';

      const validation = await validateRows(entity, parsed.rows, mapping, this.buildContext(db, entity), {
        duplicateStrategy,
        headers: parsed.headers,
      });

      // Targeted partial retry: keep only the source rows the API asked us to reprocess.
      const targetRows = rowNumbers && rowNumbers.length
        ? validation.rows.filter((row) => rowNumbers.includes(row.rowNumber))
        : validation.rows;

      const apply = importJob.mode === 'COMMIT';
      const counts = {
        totalRows: parsed.totalRows,
        processedRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
        skippedRows: 0,
        insertedRows: 0,
        updatedRows: 0,
        failedRows: 0,
      };

      // Replace any previous error rows so a re-delivery is idempotent.
      await db.importJobRow.deleteMany({ where: { jobId } });

      for (const row of targetRows) {
        if (row.status === 'INVALID') {
          counts.invalidRows++;
          await this.persistRow(db, jobId, row, 'INVALID');
          continue;
        }
        if (row.status === 'DUPLICATE') {
          counts.duplicateRows++;
          await this.persistRow(db, jobId, row, 'DUPLICATE');
          continue;
        }
        counts.validRows++;
        if (!apply) continue;
        try {
          const outcome = await this.applyRow(db, entity, row, duplicateStrategy);
          counts.processedRows++;
          if (outcome === 'UPDATED') counts.updatedRows++;
          else counts.insertedRows++;
        } catch (error) {
          counts.failedRows++;
          const message = error instanceof Error ? error.message : 'Row failed to import.';
          await this.persistRow(db, jobId, row, 'FAILED', message);
        }
      }

      const status = !apply
        ? 'VALIDATED'
        : counts.failedRows > 0 || counts.invalidRows > 0
          ? 'PARTIAL'
          : 'COMPLETED';

      await db.importJob.updateMany({
        where: { id: jobId },
        data: {
          ...counts,
          status,
          completedAt: new Date(),
          errorSummary: this.errorSummary(targetRows),
        },
      });

      await this.audit(tenantId, jobId, entity, status, counts);
      this.logger.log(
        `Import job ${jobId} (${entity.key}) ${status}: +${counts.insertedRows} ~${counts.updatedRows} ` +
          `!${counts.invalidRows} dup:${counts.duplicateRows} fail:${counts.failedRows}`,
      );
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      const message = error instanceof Error ? error.message : 'Import failed.';
      await db.importJob.updateMany({
        where: { id: jobId },
        data: finalAttempt
          ? { status: 'FAILED', message: message.slice(0, 500), completedAt: new Date() }
          : { status: 'QUEUED', message: message.slice(0, 500) },
      });
      this.logger.error(`Import job ${jobId} failed${finalAttempt ? '' : '; will retry'}: ${message}`);
      if (!finalAttempt) throw error;
    }
  }

  // ── Apply strategies ────────────────────────────────────────────────────────

  private async applyRow(
    db: AnyClient,
    entity: ImportEntityDefinition,
    row: ValidatedRow,
    duplicateStrategy: DuplicateStrategy,
  ): Promise<'INSERTED' | 'UPDATED'> {
    if (entity.strategy === 'attendance') return this.applyAttendance(db, row);
    if (entity.strategy === 'marks') return this.applyMarks(db, row);
    return this.applyGeneric(db, entity, row, duplicateStrategy);
  }

  private async applyGeneric(
    db: AnyClient,
    entity: ImportEntityDefinition,
    row: ValidatedRow,
    duplicateStrategy: DuplicateStrategy,
  ): Promise<'INSERTED' | 'UPDATED'> {
    const model = db[entity.model];
    const data = { ...row.mapped };
    if (duplicateStrategy === 'UPDATE' && row.existsInDb) {
      const where = this.duplicateWhere(entity, row.mapped);
      if (where) {
        const existing = await model.findFirst({ where });
        if (existing) {
          await model.update({ where: { id: existing.id }, data });
          return 'UPDATED';
        }
      }
    }
    await model.create({ data });
    return 'INSERTED';
  }

  private async applyAttendance(db: AnyClient, row: ValidatedRow): Promise<'INSERTED' | 'UPDATED'> {
    const mapped = row.mapped as Record<string, unknown>;
    const studentId = mapped.studentId as string | undefined;
    const date = mapped.date as Date | undefined;
    if (!studentId || !date) throw new Error('Attendance row is missing a resolved student or date.');
    const attendanceType = (mapped.attendanceType as string | undefined) ?? 'CLASS';
    const subjectCode = (mapped.subjectCode as string | undefined) ?? null;

    const start = new Date(date);
    const end = new Date(start.getTime() + 86_400_000);
    const existing = await db.studentAttendance.findFirst({
      where: { studentId, date: { gte: start, lt: end }, attendanceType, subjectCode },
    });

    const data = {
      studentId,
      date,
      attendanceType,
      subjectCode,
      status: mapped.status,
      subjectName: mapped.subjectName,
      termId: mapped.termId,
      remarks: mapped.remarks,
    };

    if (existing) {
      await db.studentAttendance.update({ where: { id: existing.id }, data });
      return 'UPDATED';
    }
    await db.studentAttendance.create({ data });
    return 'INSERTED';
  }

  private async applyMarks(db: AnyClient, row: ValidatedRow): Promise<'INSERTED' | 'UPDATED'> {
    const mapped = row.mapped as Record<string, unknown>;
    const sessionId = mapped.sessionId as string | undefined;
    const studentId = mapped.studentId as string | undefined;
    const courseId = mapped.courseId as string | undefined;
    if (!sessionId || !studentId || !courseId) {
      throw new Error('Marks row is missing a resolved exam session, student, or course.');
    }

    const subject = await db.examSubject.findFirst({ where: { sessionId, courseId } });
    if (!subject) throw new Error('Subject is not part of the exam session (create the exam subject first).');

    let registration = await db.examRegistration.findFirst({ where: { sessionId, studentId } });
    if (!registration) {
      registration = await db.examRegistration.create({ data: { sessionId, studentId, status: 'REGISTERED' } });
    }

    const marksData = {
      marksObtained: mapped.marksObtained,
      graceMarks: mapped.graceMarks ?? 0,
      attendanceStatus: mapped.attendanceStatus ?? 'PRESENT',
      remark: mapped.remark,
    };

    const existing = await db.examMarksEntry.findFirst({ where: { registrationId: registration.id, subjectId: subject.id } });
    if (existing) {
      await db.examMarksEntry.update({ where: { id: existing.id }, data: marksData });
      return 'UPDATED';
    }
    await db.examMarksEntry.create({
      data: { registrationId: registration.id, subjectId: subject.id, studentId, ...marksData },
    });
    return 'INSERTED';
  }

  private duplicateWhere(entity: ImportEntityDefinition, mapped: Record<string, unknown>): Record<string, unknown> | null {
    for (const field of entity.duplicateKey) {
      const value = mapped[field];
      if (value !== undefined && value !== null && value !== '') return { [field]: value };
    }
    if (entity.duplicateKeyFallback) {
      const value = mapped[entity.duplicateKeyFallback];
      if (value !== undefined && value !== null && value !== '') return { [entity.duplicateKeyFallback]: value };
    }
    return null;
  }

  // ── Persistence helpers ─────────────────────────────────────────────────────

  private async persistRow(
    db: AnyClient,
    jobId: string,
    row: ValidatedRow,
    status: 'INVALID' | 'DUPLICATE' | 'FAILED',
    message?: string,
  ): Promise<void> {
    await db.importJobRow.create({
      data: {
        jobId,
        rowNumber: row.rowNumber,
        status,
        sourceKey: row.sourceKey,
        rawData: row.raw,
        mappedData: row.mapped,
        errors: row.issues,
        message: message ?? null,
      },
    });
  }

  private errorSummary(rows: ValidatedRow[]): Record<string, number> {
    const byCode: Record<string, number> = {};
    for (const row of rows) {
      for (const issue of row.issues) {
        byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
      }
    }
    return byCode;
  }

  private buildContext(db: AnyClient, entity: ImportEntityDefinition): ImportContext {
    return {
      resolveRef: async (ref: ImportFieldRef, codes: string[]) => {
        if (codes.length === 0) return new Map();
        const rows = await db[ref.model].findMany({
          where: { [ref.codeField]: { in: codes, mode: 'insensitive' }, ...(ref.filter ?? {}) },
          select: { id: true, [ref.codeField]: true },
        });
        return new Map(rows.map((r: Record<string, unknown>) => [String(r[ref.codeField]), String(r.id)]));
      },
      existingKeys: async (keys: string[]) => {
        if (entity.strategy !== 'generic' || keys.length === 0) return new Set<string>();
        const fields = [...entity.duplicateKey, ...(entity.duplicateKeyFallback ? [entity.duplicateKeyFallback] : [])];
        const rows = await db[entity.model].findMany({
          where: { OR: fields.map((f) => ({ [f]: { in: keys, mode: 'insensitive' } })) },
          select: Object.fromEntries(fields.map((f) => [f, true])),
        });
        const found = new Set<string>();
        for (const record of rows) {
          for (const f of fields) {
            const value = record[f];
            if (typeof value === 'string' && value !== '') found.add(value.toLowerCase());
          }
        }
        return found;
      },
    };
  }

  /** Writes the job-completion entry through the unscoped control-plane client (the worker has
   *  no AuditService, and PlatformAuditLog is not a tenant-owned model). */
  private async audit(
    tenantId: string,
    jobId: string,
    entity: ImportEntityDefinition,
    status: string,
    counts: Record<string, number>,
  ): Promise<void> {
    try {
      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'TENANT',
          tenantId,
          actorType: 'SYSTEM',
          action: status === 'FAILED' ? AUDIT_ACTIONS.IMPORT_JOB_FAILED : AUDIT_ACTIONS.IMPORT_JOB_COMPLETED,
          module: AUDIT_MODULES.IMPORTS,
          entityType: 'ImportJob',
          entityId: jobId,
          after: { entity: entity.key, status, ...counts },
        },
      });
    } catch (error) {
      this.logger.warn(`Could not write completion audit for import job ${jobId}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
