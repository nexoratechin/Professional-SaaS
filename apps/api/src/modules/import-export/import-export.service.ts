/**
 * Bulk import/export orchestration.
 *
 * The API owns the fast, interactive half: it hands out presigned upload URLs, parses and
 * validates the uploaded file for a live preview (using @college-erp/imports with a small
 * row cap), persists the import job + committed mapping, and hands the heavy apply work to the
 * worker over BullMQ. Templates, saved mappings, history reads, error-report downloads,
 * synchronous entity exports and partial retries all live here too.
 *
 * Nothing inserts unvalidated bulk data: the worker re-parses and re-validates every row with
 * the same shared engine before any write.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
} from '@college-erp/auth';
import type { Prisma } from '@college-erp/database';
import {
  autoMapHeaders,
  buildTemplateFile,
  buildTemplateSheet,
  detectFormat,
  getImportEntity,
  listImportEntities,
  parseTabularFile,
  serializeTabularFile,
  validateRows,
  type ImportContext,
  type ImportEntityDefinition,
  type ImportFieldRef,
  type ImportFileFormat,
  type ValidatedRow,
} from '@college-erp/imports';
import { QUEUE_NAMES } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { PermissionsService } from '../rbac/permissions.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateImportJobDto,
  ExportEntityDto,
  ListImportJobsDto,
  ListImportRowsDto,
  PreviewImportDto,
  SaveImportTemplateDto,
  UploadUrlDto,
} from './dto/import-export.dto';

type AnyClient = Record<string, any>;

const PREVIEW_ROW_LIMIT = 100;
const EXPORT_ROW_CAP = 50_000;
const UPLOAD_URL_TTL_SECONDS = 300;

const CONTENT_TYPES: Record<ImportFileFormat, string> = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const EXPORT_EXTENSIONS: Record<ImportFileFormat, string> = { CSV: 'csv', XLSX: 'xlsx' };

@Injectable()
export class ImportExportService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.DATA_IMPORTS) private readonly importQueue: Queue,
  ) {}

  private get client(): AnyClient {
    return this.tenantPrisma.client as unknown as AnyClient;
  }

  // ── Registry / metadata ─────────────────────────────────────────────────────

  listEntities(): Array<ReturnType<typeof this.toEntityView>> {
    return listImportEntities().map((entity) => this.toEntityView(entity));
  }

  private toEntityView(entity: ImportEntityDefinition) {
    return {
      key: entity.key,
      label: entity.label,
      module: entity.module,
      importPermission: entity.importPermission,
      viewPermission: entity.viewPermission,
      duplicateKey: entity.duplicateKey,
      fields: entity.fields.map((f) => ({
        field: f.field,
        header: f.header,
        aliases: f.aliases ?? [],
        required: Boolean(f.required),
        type: f.type,
        enumValues: f.enumValues ?? null,
        ref: f.ref ?? null,
        description: f.description ?? null,
        sample: f.sample ?? null,
      })),
    };
  }

  private requireEntity(key: string): ImportEntityDefinition {
    const entity = getImportEntity(key);
    if (!entity) throw new NotFoundException(`Unknown import entity: ${key}`);
    return entity;
  }

  // ── Authorization ───────────────────────────────────────────────────────────

  private async effectivePermissions(tenantId: string, userId: string): Promise<string[]> {
    return this.permissions.getEffectivePermissions(tenantId, userId);
  }

  private async assertPermission(tenantId: string, userId: string, permission: string): Promise<void> {
    const permissions = await this.effectivePermissions(tenantId, userId);
    if (!permissions.includes(permission)) {
      throw new ForbiddenException(`Missing required permission: ${permission}`);
    }
  }

  private async assertEntityPermission(
    tenantId: string,
    userId: string,
    entity: ImportEntityDefinition,
    action: 'view' | 'import',
  ): Promise<void> {
    await this.assertPermission(tenantId, userId, action === 'view' ? entity.viewPermission : entity.importPermission);
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async requestUploadUrl(tenantId: string, userId: string, entityKey: string, dto: UploadUrlDto) {
    const entity = this.requireEntity(entityKey);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');
    const format = detectFormat(dto.fileName);
    const key = this.storage.buildKey(tenantId, 'imports', dto.fileName);
    const uploadUrl = await this.storage.getUploadUrl(tenantId, key, CONTENT_TYPES[format]);
    return { uploadUrl, storageKey: key, format, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  // ── Preview (synchronous parse + validate, no writes) ─────────────────────────

  async preview(tenantId: string, userId: string, entityKey: string, dto: PreviewImportDto) {
    const entity = this.requireEntity(entityKey);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');
    const format = detectFormat(dto.storageKey);
    const buffer = await this.storage.downloadBuffer(tenantId, dto.storageKey);
    const parsed = parseTabularFile(buffer, format);
    const mapping = dto.mapping ?? autoMapHeaders(entity, parsed.headers);
    const strategy = dto.duplicateStrategy ?? 'SKIP';
    const limit = dto.limit ?? PREVIEW_ROW_LIMIT;

    const result = await validateRows(entity, parsed.rows, mapping, this.buildContext(entity), {
      duplicateStrategy: strategy,
      limit,
      headers: parsed.headers,
    });

    return {
      entity: entity.key,
      format,
      headers: parsed.headers,
      mapping,
      templateHeaders: buildTemplateSheet(entity).headers,
      summary: { ...result.summary, previewedRows: result.rows.length },
      rows: result.rows.map((row) => this.toRowView(row)),
    };
  }

  // ── Job creation ──────────────────────────────────────────────────────────────

  async createJob(tenantId: string, userId: string, entityKey: string, dto: CreateImportJobDto) {
    const entity = this.requireEntity(entityKey);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');

    const exists = await this.storage.objectExists(tenantId, dto.storageKey);
    if (!exists) throw new BadRequestException('The uploaded file could not be found in storage.');

    const format = dto.format ?? detectFormat(dto.fileName);
    const job = await (this.client.importJob.create({
      data: {
        entityType: entity.key,
        format,
        status: 'QUEUED',
        mode: dto.mode ?? 'COMMIT',
        fileName: dto.fileName,
        storageKey: dto.storageKey,
        mapping: (dto.mapping ?? undefined) as Prisma.InputJsonValue | undefined,
        options: (dto.options ?? { duplicateStrategy: 'SKIP' }) as unknown as Prisma.InputJsonValue,
        requestedById: userId,
      },
    }) as Promise<{ id: string; status: string; mode: string }>);

    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_JOB_CREATED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportJob',
      entityId: job.id,
      after: { entity: entity.key, format, mode: job.mode, fileName: dto.fileName },
    });

    await this.enqueue(job.id, tenantId, userId);
    return this.getJob(tenantId, userId, job.id, {});
  }

  private async enqueue(jobId: string, tenantId: string, _userId: string, rowNumbers?: number[]): Promise<void> {
    try {
      await this.importQueue.add(
        'process',
        { tenantId, jobId, ...(rowNumbers ? { rowNumbers } : {}) },
        { jobId: `import-${jobId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 },
      );
    } catch {
      await this.client.importJob.updateMany({
        where: { id: jobId },
        data: { status: 'FAILED', message: 'Could not enqueue import job.', completedAt: new Date() },
      });
      throw new ServiceUnavailableException('Import queue is unavailable. Please try again.');
    }
  }

  // ── History / detail ──────────────────────────────────────────────────────────

  private async allowedEntityKeys(tenantId: string, userId: string): Promise<string[]> {
    const permissions = await this.effectivePermissions(tenantId, userId);
    return listImportEntities()
      .filter((entity) => permissions.includes(entity.viewPermission))
      .map((entity) => entity.key);
  }

  async listJobs(tenantId: string, userId: string, dto: ListImportJobsDto) {
    const allowed = await this.allowedEntityKeys(tenantId, userId);
    if (dto.entity && !allowed.includes(dto.entity)) {
      throw new ForbiddenException(`You cannot view ${dto.entity} import history.`);
    }
    const entityFilter = dto.entity ? [dto.entity] : allowed;
    const where: Prisma.ImportJobWhereInput = {
      entityType: { in: entityFilter },
      ...(dto.status ? { status: dto.status as Prisma.ImportJobWhereInput['status'] } : {}),
    };
    const [items, total] = await Promise.all([
      this.client.importJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip ?? 0,
        take: dto.take ?? 25,
      }),
      this.client.importJob.count({ where }),
    ]);
    return { items: items.map((job: Record<string, unknown>) => this.toJobView(job)), total };
  }

  async getJob(tenantId: string, userId: string, jobId: string, dto: ListImportRowsDto) {
    const job = await this.client.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found.');
    const entity = this.requireEntity(job.entityType as string);
    await this.assertEntityPermission(tenantId, userId, entity, 'view');

    const rowWhere: Prisma.ImportJobRowWhereInput = {
      jobId,
      ...(dto.status ? { status: dto.status as Prisma.ImportJobRowWhereInput['status'] } : {}),
    };
    const [rows, rowTotal] = await Promise.all([
      this.client.importJobRow.findMany({ where: rowWhere, orderBy: { rowNumber: 'asc' }, skip: dto.skip ?? 0, take: dto.take ?? 100 }),
      this.client.importJobRow.count({ where: rowWhere }),
    ]);
    return {
      job: this.toJobView(job as Record<string, unknown>),
      rows: rows.map((row: Record<string, unknown>) => this.toStoredRowView(row)),
      rowTotal,
    };
  }

  async downloadErrors(tenantId: string, userId: string, jobId: string, format: ImportFileFormat) {
    const job = await this.client.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found.');
    const entity = this.requireEntity(job.entityType as string);
    await this.assertEntityPermission(tenantId, userId, entity, 'view');

    const rows = await this.client.importJobRow.findMany({ where: { jobId }, orderBy: { rowNumber: 'asc' } });
    const headers = ['Row', 'Status', 'Key', 'Errors'];
    const report = rows.map((row: Record<string, unknown>) => ({
      Row: row.rowNumber,
      Status: row.status,
      Key: row.sourceKey ?? '',
      Errors: this.formatErrors(row.errors),
    }));
    const buffer = serializeTabularFile(format, headers, report as Array<Record<string, unknown>>);
    const signed = await this.storeAndSign(tenantId, 'imports/errors', `${entity.key}-${jobId}-errors`, buffer, format);
    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_JOB_DOWNLOADED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportJob',
      entityId: jobId,
    });
    return signed;
  }

  // ── Retry / cancel ────────────────────────────────────────────────────────────

  async retryJob(tenantId: string, userId: string, jobId: string) {
    const job = await this.client.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found.');
    const entity = this.requireEntity(job.entityType as string);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');

    const failedRows = await this.client.importJobRow.findMany({
      where: { jobId, status: { in: ['INVALID', 'FAILED'] } },
      select: { rowNumber: true },
    });
    if (failedRows.length === 0) {
      throw new BadRequestException('This job has no failed or invalid rows to retry.');
    }

    const retry = await this.client.importJob.create({
      data: {
        entityType: job.entityType,
        format: job.format,
        status: 'QUEUED',
        mode: 'COMMIT',
        fileName: job.fileName,
        storageKey: job.storageKey,
        mapping: job.mapping as Prisma.InputJsonValue,
        options: job.options as Prisma.InputJsonValue,
        requestedById: userId,
        retryOfId: job.id,
        revision: (job.revision as number) + 1,
      },
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_JOB_RETRIED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportJob',
      entityId: retry.id,
      after: { retryOf: job.id, rowNumbers: failedRows.map((r: { rowNumber: number }) => r.rowNumber) },
    });

    await this.enqueue(retry.id, tenantId, userId, failedRows.map((r: { rowNumber: number }) => r.rowNumber));
    return this.getJob(tenantId, userId, retry.id, {});
  }

  async cancelJob(tenantId: string, userId: string, jobId: string) {
    const job = await this.client.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import job not found.');
    const entity = this.requireEntity(job.entityType as string);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');
    if (!['PENDING', 'QUEUED', 'VALIDATING', 'VALIDATED'].includes(job.status as string)) {
      throw new ConflictException('Only pending or queued jobs can be cancelled.');
    }
    await this.client.importJob.updateMany({ where: { id: jobId }, data: { status: 'CANCELLED', completedAt: new Date() } });
    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_JOB_CANCELLED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportJob',
      entityId: jobId,
    });
    return { cancelled: true };
  }

  // ── Templates ─────────────────────────────────────────────────────────────────

  async downloadTemplate(tenantId: string, userId: string, entityKey: string, format: ImportFileFormat) {
    const entity = this.requireEntity(entityKey);
    await this.assertEntityPermission(tenantId, userId, entity, 'view');
    const { buffer, fileName } = buildTemplateFile(entity, format);
    const signed = await this.storeAndSign(tenantId, 'imports/templates', fileName.replace(/\.[^.]+$/, ''), buffer, format, fileName);
    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DOWNLOADED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportTemplate',
      after: { entity: entity.key, format },
    });
    return signed;
  }

  async listTemplates(tenantId: string, userId: string, entityKey?: string) {
    const allowed = await this.allowedEntityKeys(tenantId, userId);
    const where: Prisma.ImportTemplateWhereInput = {
      entityType: entityKey ? entityKey : { in: allowed },
      ...(entityKey && !allowed.includes(entityKey) ? { id: { in: [] } } : {}),
    };
    const items = await this.client.importTemplate.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
    return { items };
  }

  async saveTemplate(tenantId: string, userId: string, dto: SaveImportTemplateDto) {
    const entity = this.requireEntity(dto.entity);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');
    try {
      const template = await this.client.importTemplate.create({
        data: {
          entityType: entity.key,
          name: dto.name,
          description: dto.description,
          mapping: dto.mapping as Prisma.InputJsonValue,
          isDefault: dto.isDefault ?? false,
          createdById: userId,
        },
      });
      await this.audit.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: AUDIT_ACTIONS.IMPORT_TEMPLATE_SAVED,
        module: AUDIT_MODULES.IMPORTS,
        entityType: 'ImportTemplate',
        entityId: template.id,
        after: { entity: entity.key, name: dto.name },
      });
      return template;
    } catch {
      throw new ConflictException('A saved mapping with that name already exists for this entity.');
    }
  }

  async deleteTemplate(tenantId: string, userId: string, id: string) {
    const template = await this.client.importTemplate.findFirst({ where: { id } });
    if (!template) throw new NotFoundException('Saved mapping not found.');
    const entity = this.requireEntity(template.entityType as string);
    await this.assertEntityPermission(tenantId, userId, entity, 'import');
    await this.client.importTemplate.delete({ where: { id } });
    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DELETED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportTemplate',
      entityId: id,
    });
    return { deleted: true };
  }

  // ── Entity export ─────────────────────────────────────────────────────────────

  async exportEntity(tenantId: string, userId: string, entityKey: string, dto: ExportEntityDto) {
    const entity = this.requireEntity(entityKey);
    await this.assertEntityPermission(tenantId, userId, entity, 'view');
    const format = dto.format ?? 'CSV';
    const headers = entity.fields.map((f) => f.header);
    const rows = await this.buildExportRows(entity, dto.take ?? EXPORT_ROW_CAP, dto.q);
    const buffer = serializeTabularFile(format, headers, rows);
    const signed = await this.storeAndSign(tenantId, 'imports/exports', `${entity.key}-export`, buffer, format);
    await this.audit.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.EXPORT_COMPLETED,
      module: AUDIT_MODULES.IMPORTS,
      entityType: 'ImportExport',
      after: { entity: entity.key, format, rowCount: rows.length },
    });
    return { ...signed, rowCount: rows.length, entity: entity.key, format };
  }

  private async buildExportRows(
    entity: ImportEntityDefinition,
    take: number,
    _q?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const cap = Math.min(take, EXPORT_ROW_CAP);
    if (entity.strategy === 'attendance') {
      const records = await this.client.studentAttendance.findMany({
        take: cap,
        orderBy: { date: 'desc' },
        include: { student: { select: { admissionNumber: true } }, term: { select: { code: true } } },
      });
      return records.map((r: any) => ({
        'Admission No': r.student?.admissionNumber ?? '',
        Date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date ?? ''),
        Status: r.status,
        'Attendance Type': r.attendanceType,
        'Subject Code': r.subjectCode ?? '',
        'Subject Name': r.subjectName ?? '',
        'Term Code': r.term?.code ?? '',
        Remarks: r.remarks ?? '',
      }));
    }
    if (entity.strategy === 'marks') {
      const records = await this.client.examMarksEntry.findMany({
        take: cap,
        orderBy: { createdAt: 'desc' },
        include: {
          student: { select: { admissionNumber: true } },
          subject: { select: { course: { select: { code: true } }, session: { select: { code: true } } } },
        },
      });
      return records.map((r: any) => ({
        'Exam Session Code': r.subject?.session?.code ?? '',
        'Admission No': r.student?.admissionNumber ?? '',
        'Course Code': r.subject?.course?.code ?? '',
        'Marks Obtained': r.marksObtained ?? '',
        'Grace Marks': r.graceMarks ?? 0,
        'Attendance Status': r.attendanceStatus,
        Remark: r.remark ?? '',
      }));
    }

    const records = await this.client[entity.model].findMany({ take: cap, orderBy: { createdAt: 'desc' } });
    const refMaps = await this.resolveExportRefs(entity, records);
    return records.map((record: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const field of entity.fields) {
        if (field.ref) {
          const id = record[field.ref.targetField];
          out[field.header] = (id && refMaps.get(field.ref)?.get(String(id))) ?? '';
          continue;
        }
        let value = record[field.field];
        if (value instanceof Date) value = value.toISOString().slice(0, 10);
        if (field.transform === 'rupeesToCents' && typeof value === 'number') value = value / 100;
        out[field.header] = value ?? '';
      }
      return out;
    });
  }

  private async resolveExportRefs(
    entity: ImportEntityDefinition,
    records: Array<Record<string, unknown>>,
  ): Promise<Map<ImportFieldRef, Map<string, string>>> {
    const result = new Map<ImportFieldRef, Map<string, string>>();
    for (const field of entity.fields) {
      if (!field.ref) continue;
      const ids = [...new Set(records.map((r) => r[field.ref!.targetField]).filter((v): v is string => typeof v === 'string' && v !== ''))];
      if (ids.length === 0) continue;
      const rows = await this.client[field.ref.model].findMany({
        where: { id: { in: ids } },
        select: { id: true, [field.ref.codeField]: true },
      });
      result.set(field.ref, new Map(rows.map((r: Record<string, unknown>) => [String(r.id), String(r[field.ref!.codeField] ?? '')])));
    }
    return result;
  }

  // ── Storage helpers ───────────────────────────────────────────────────────────

  private async storeAndSign(
    tenantId: string,
    category: string,
    baseName: string,
    buffer: Buffer,
    format: ImportFileFormat,
    fileName = `${baseName}.${EXPORT_EXTENSIONS[format]}`,
  ) {
    const key = this.storage.buildKey(tenantId, category, fileName);
    await this.storage.uploadBuffer(key, buffer, CONTENT_TYPES[format]);
    const url = await this.storage.getDownloadUrl(tenantId, key, { contentType: CONTENT_TYPES[format], filename: fileName });
    return { url, fileName, storageKey: key, expiresInSeconds: 300 };
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────

  private buildContext(entity: ImportEntityDefinition): ImportContext {
    const client = this.client;
    return {
      resolveRef: async (ref, codes) => {
        if (codes.length === 0) return new Map();
        const rows = await client[ref.model].findMany({
          where: { [ref.codeField]: { in: codes, mode: 'insensitive' }, ...(ref.filter ?? {}) },
          select: { id: true, [ref.codeField]: true },
        });
        const map = new Map<string, string>();
        for (const row of rows) {
          const code = row[ref.codeField];
          if (typeof code === 'string') map.set(code, row.id as string);
        }
        return map;
      },
      existingKeys: async (keys) => {
        if (entity.strategy !== 'generic' || keys.length === 0) return new Set();
        const fields = [...entity.duplicateKey, ...(entity.duplicateKeyFallback ? [entity.duplicateKeyFallback] : [])];
        const rows = await client[entity.model].findMany({
          where: { OR: fields.map((f) => ({ [f]: { in: keys, mode: 'insensitive' } })) },
          select: Object.fromEntries(fields.map((f) => [f, true])),
        });
        const found = new Set<string>();
        for (const row of rows) {
          for (const f of fields) {
            const value = row[f];
            if (typeof value === 'string' && value !== '') found.add(value.toLowerCase());
          }
        }
        return found;
      },
    };
  }

  private toRowView(row: ValidatedRow) {
    return {
      rowNumber: row.rowNumber,
      status: row.status,
      sourceKey: row.sourceKey,
      issues: row.issues,
      raw: row.raw,
      mapped: row.mapped,
      existsInDb: row.existsInDb,
    };
  }

  private toStoredRowView(row: Record<string, unknown>) {
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status: row.status,
      sourceKey: row.sourceKey,
      errors: row.errors ?? [],
      message: row.message ?? null,
      rawData: row.rawData ?? null,
      targetId: row.targetId ?? null,
    };
  }

  private toJobView(job: Record<string, unknown>) {
    return {
      id: job.id,
      entityType: job.entityType,
      format: job.format,
      status: job.status,
      mode: job.mode,
      fileName: job.fileName,
      sizeBytes: job.sizeBytes,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      validRows: job.validRows,
      invalidRows: job.invalidRows,
      duplicateRows: job.duplicateRows,
      skippedRows: job.skippedRows,
      insertedRows: job.insertedRows,
      updatedRows: job.updatedRows,
      failedRows: job.failedRows,
      errorSummary: job.errorSummary ?? null,
      message: job.message ?? null,
      requestedById: job.requestedById ?? null,
      retryOfId: job.retryOfId ?? null,
      revision: job.revision,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private formatErrors(errors: unknown): string {
    if (!Array.isArray(errors)) return '';
    return errors
      .map((e) => {
        if (e && typeof e === 'object') {
          const entry = e as { field?: string; message?: string };
          return entry.field ? `${entry.field}: ${entry.message ?? ''}` : (entry.message ?? '');
        }
        return String(e);
      })
      .filter((s) => s !== '')
      .join('; ');
  }
}
