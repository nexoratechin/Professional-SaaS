import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import type { Prisma, ReportExportFormat as DbReportExportFormat, ReportScheduleFrequency as DbReportScheduleFrequency, ReportType as DbReportType } from '@college-erp/database';
import {
  calculateNextRunAt,
  executeReport,
  getReportCatalog,
  getReportDefinition,
  type ReportFilters,
  type ReportPrisma,
  type ReportScopeGrant,
  type ReportTemplateDefinition,
} from '@college-erp/reporting';
import { QUEUE_NAMES } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  asReportScopeGrants,
  assertNonEmptyEffectiveScope,
  intersectReportScope,
  scopeIsGlobal,
} from './reports-scope';
import {
  type CreateReportExportDto,
  type CreateReportScheduleDto,
  type CreateReportTemplateDto,
  type ListReportRunsDto,
  type ListReportSchedulesDto,
  type ListReportTemplatesDto,
  type ListSavedReportsDto,
  type PreviewReportDto,
  type ReportFiltersDto,
  type UpdateReportScheduleDto,
  type UpdateReportTemplateDto,
  type UpdateSavedReportDto,
  type CreateSavedReportDto,
} from './dto/reports.dto';

const REPORTS_VIEW = PERMISSION_KEYS.REPORTS_VIEW;
const REPORTS_MANAGE = PERMISSION_KEYS.REPORTS_MANAGE;
const RUN_EXPIRY_DAYS = 7;

interface CreatedRunRecord {
  id: string;
  reportType: string;
  format: string;
  status: string;
  rowCount: number;
  fileName: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

interface UntypedCreateDelegate {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

interface UntypedCreateClient {
  reportRun: { create(args: { data: Record<string, unknown> }): Promise<CreatedRunRecord> };
  savedReport: UntypedCreateDelegate;
  reportTemplate: UntypedCreateDelegate;
  reportSchedule: UntypedCreateDelegate;
}

interface EffectiveReportAccess {
  reportGrants: ReportScopeGrant[];
  sourceGrants: ReportScopeGrant[];
  effectiveGrants: ReportScopeGrant[];
  sourcePermission: string;
  actorUserId: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.REPORT_EXPORTS) private readonly exportQueue: Queue,
  ) {}

  async catalog(user: AuthenticatedUser) {
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    const hasManage = Boolean(effective[REPORTS_MANAGE]?.length);
    return getReportCatalog()
      .filter((definition) => Boolean(effective[REPORTS_VIEW]?.length) && Boolean(effective[definition.sourcePermission]?.length))
      .map((definition) => ({
      reportType: definition.reportType,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      sourcePermission: definition.sourcePermission,
      sourcePath: definition.sourcePath,
      supportedFilters: definition.supportedFilters,
      columns: definition.columns,
      canExport: Boolean(effective[PERMISSION_KEYS.REPORTS_EXPORT]?.length) || hasManage,
      canManage: hasManage,
    }));
  }

  async options(user: AuthenticatedUser) {
    const grants = asReportScopeGrants(await this.permissions.getScopeGrantsFor(user.tenantId, user.id, REPORTS_VIEW));
    const global = scopeIsGlobal(grants);
    const campusIds = grants.flatMap((grant) => (grant.campusId ? [grant.campusId] : []));
    const departmentIds = grants.flatMap((grant) => (grant.departmentId ? [grant.departmentId] : []));
    const programIds = grants.flatMap((grant) => (grant.programId ? [grant.programId] : []));

    const [campuses, departments, programs, sections, academicYears, terms] = await Promise.all([
      this.tenantPrisma.client.campus.findMany({
        where: global ? { deletedAt: null } : { deletedAt: null, id: { in: campusIds } },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.tenantPrisma.client.department.findMany({
        where: global
          ? { deletedAt: null }
          : { deletedAt: null, OR: [{ id: { in: departmentIds } }, { campusId: { in: campusIds } }] },
        select: { id: true, code: true, name: true, campusId: true },
        orderBy: { name: 'asc' },
        take: 500,
      }),
      this.tenantPrisma.client.program.findMany({
        where: global
          ? { deletedAt: null }
          : {
              deletedAt: null,
              OR: [{ id: { in: programIds } }, { departmentId: { in: departmentIds } }, { department: { campusId: { in: campusIds } } }],
            },
        select: { id: true, code: true, name: true, departmentId: true },
        orderBy: { name: 'asc' },
        take: 1000,
      }),
      this.tenantPrisma.client.section.findMany({
        where: global
          ? { deletedAt: null }
          : {
              deletedAt: null,
              OR: [
                { programId: { in: programIds } },
                { program: { departmentId: { in: departmentIds } } },
                { program: { department: { campusId: { in: campusIds } } } },
              ],
            },
        select: { id: true, code: true, name: true, programId: true },
        orderBy: { name: 'asc' },
        take: 1000,
      }),
      this.tenantPrisma.client.academicYear.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { startDate: 'desc' },
        take: 50,
      }),
      this.tenantPrisma.client.term.findMany({
        select: { id: true, code: true, name: true, academicYearId: true },
        orderBy: { startDate: 'desc' },
        take: 200,
      }),
    ]);

    return { campus: campuses, department: departments, program: programs, sections, academicYears, terms };
  }

  async preview(user: AuthenticatedUser, dto: PreviewReportDto) {
    const target = await this.resolveTarget(user, dto);
    const access = await this.resolveAccess(user, target.reportType);
    const result = await executeReport(this.enginePrisma(), target.reportType, target.filters, access.effectiveGrants, {
      mode: 'preview',
      limit: dto.limit,
      template: target.template,
      actorUserId: user.id,
    });
    return result;
  }

  async createExport(user: AuthenticatedUser, dto: CreateReportExportDto) {
    const target = await this.resolveTarget(user, dto);
    const access = await this.resolveAccess(user, target.reportType);
    const scopeSnapshot = this.snapshot(access);
    const run = await this.untypedCreate().reportRun.create({
      data: {
        reportType: target.reportType as DbReportType,
        format: dto.format as DbReportExportFormat,
        status: 'QUEUED',
        filters: this.json(target.filters),
        scopeSnapshot: this.json(scopeSnapshot),
        templateSnapshot: target.template ? this.json(target.template) : undefined,
        requestedById: user.id,
        savedReportId: target.savedReportId,
        templateId: target.templateId,
        expiresAt: new Date(Date.now() + RUN_EXPIRY_DAYS * 86_400_000),
      },
    });

    try {
      await this.exportQueue.add(
        'generate',
        { tenantId: user.tenantId, runId: run.id },
        { jobId: `report-${run.id}`, attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 500 },
      );
    } catch {
      await this.tenantPrisma.client.reportRun.updateMany({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: 'Could not enqueue report export.', completedAt: new Date() },
      });
      throw new ServiceUnavailableException('Report export queue is unavailable. Please try again.');
    }

    return this.toRunView(run);
  }

  async listRuns(user: AuthenticatedUser, dto: ListReportRunsDto) {
    const manage = await this.hasManage(user);
    const where: Prisma.ReportRunWhereInput = {
      ...(manage ? {} : { OR: [{ requestedById: user.id }, { schedule: { createdById: user.id } }] }),
      ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
      ...(dto.status ? { status: dto.status as Prisma.ReportRunWhereInput['status'] } : {}),
      ...(dto.dateFrom || dto.dateTo
        ? { createdAt: { ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}), ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}) } }
        : {}),
    };
    const [runs, total] = await Promise.all([
      this.tenantPrisma.client.reportRun.findMany({
        where,
        select: {
          id: true,
          reportType: true,
          format: true,
          status: true,
          rowCount: true,
          fileName: true,
          errorMessage: true,
          requestedById: true,
          scheduleId: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: dto.skip ?? 0,
        take: dto.take ?? 25,
      }),
      this.tenantPrisma.client.reportRun.count({ where }),
    ]);
    return { items: runs, total };
  }

  async downloadRun(user: AuthenticatedUser, runId: string) {
    const manage = await this.hasManage(user);
    const run = await this.tenantPrisma.client.reportRun.findFirst({
      where: { id: runId, ...(manage ? {} : { OR: [{ requestedById: user.id }, { schedule: { createdById: user.id } }] }) },
    });
    if (!run) throw new NotFoundException('Report run not found.');
    if (run.status !== 'COMPLETED' || !run.objectKey || !run.fileName) {
      throw new BadRequestException('This report is not ready for download.');
    }
    if (run.expiresAt && run.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This report export has expired.');
    }
    const url = await this.storage.getDownloadUrl(user.tenantId, run.objectKey, {
      contentType: this.contentType(run.format),
      filename: run.fileName,
    });
    return { url, fileName: run.fileName, expiresInSeconds: 300 };
  }

  async listSaved(user: AuthenticatedUser, dto: ListSavedReportsDto) {
    const manage = await this.hasManage(user);
    const where: Prisma.SavedReportWhereInput = {
      ...(manage ? {} : { ownerId: user.id }),
      ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
      ...(dto.q ? { name: { contains: dto.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.tenantPrisma.client.savedReport.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: dto.skip ?? 0,
        take: dto.take ?? 50,
      }),
      this.tenantPrisma.client.savedReport.count({ where }),
    ]);
    return { items, total };
  }

  async createSaved(user: AuthenticatedUser, dto: CreateSavedReportDto) {
    this.assertKnownReportType(dto.reportType);
    try {
      return await this.untypedCreate().savedReport.create({
        data: {
          ownerId: user.id,
          name: dto.name,
          reportType: dto.reportType as DbReportType,
          filters: this.json(dto.filters ?? {}),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
    } catch {
      throw new ConflictException('A saved report with that name already exists.');
    }
  }

  async updateSaved(user: AuthenticatedUser, id: string, dto: UpdateSavedReportDto) {
    const saved = await this.findOwnedSaved(user, id);
    if (dto.reportType) this.assertKnownReportType(dto.reportType);
    return this.tenantPrisma.client.savedReport.update({
      where: { id: saved.id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
        ...(dto.filters ? { filters: this.json(dto.filters) } : {}),
        updatedBy: user.id,
      },
    });
  }

  async deleteSaved(user: AuthenticatedUser, id: string) {
    const saved = await this.findOwnedSaved(user, id);
    await this.tenantPrisma.client.savedReport.delete({ where: { id: saved.id } });
    return { deleted: true };
  }

  async listTemplates(user: AuthenticatedUser, dto: ListReportTemplatesDto) {
    const where: Prisma.ReportTemplateWhereInput = {
      ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
      ...(dto.q ? { name: { contains: dto.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.tenantPrisma.client.reportTemplate.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: dto.skip ?? 0, take: dto.take ?? 50 }),
      this.tenantPrisma.client.reportTemplate.count({ where }),
    ]);
    return { items, total };
  }

  async createTemplate(user: AuthenticatedUser, dto: CreateReportTemplateDto) {
    const definition = this.assertKnownReportType(dto.reportType);
    this.validateTemplate(dto.definition as unknown as ReportTemplateDefinition, definition.reportType);
    try {
      return await this.untypedCreate().reportTemplate.create({
        data: {
          name: dto.name,
          description: dto.description,
          reportType: dto.reportType as DbReportType,
          definition: this.json(dto.definition),
          isSystem: false,
          createdById: user.id,
        },
      });
    } catch {
      throw new ConflictException('A template with that name already exists.');
    }
  }

  async updateTemplate(user: AuthenticatedUser, id: string, dto: UpdateReportTemplateDto) {
    const template = await this.tenantPrisma.client.reportTemplate.findFirst({ where: { id } });
    if (!template) throw new NotFoundException('Report template not found.');
    if (template.isSystem) throw new ForbiddenException('System templates cannot be modified.');
    const reportType = dto.reportType ?? template.reportType;
    if (dto.reportType || dto.definition) {
      const definition = this.assertKnownReportType(reportType);
      this.validateTemplate(
        (dto.definition ?? template.definition) as unknown as ReportTemplateDefinition,
        definition.reportType,
      );
    }
    return this.tenantPrisma.client.reportTemplate.update({
      where: { id: template.id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
        ...(dto.definition ? { definition: this.json(dto.definition) } : {}),
      },
    });
  }

  async deleteTemplate(user: AuthenticatedUser, id: string) {
    const template = await this.tenantPrisma.client.reportTemplate.findFirst({ where: { id } });
    if (!template) throw new NotFoundException('Report template not found.');
    if (template.isSystem) throw new ForbiddenException('System templates cannot be deleted.');
    await this.tenantPrisma.client.reportTemplate.delete({ where: { id: template.id } });
    return { deleted: true };
  }

  async listSchedules(user: AuthenticatedUser, dto: ListReportSchedulesDto) {
    const manage = await this.hasManage(user);
    const where: Prisma.ReportScheduleWhereInput = {
      ...(manage ? {} : { createdById: user.id }),
      ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.q ? { name: { contains: dto.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.tenantPrisma.client.reportSchedule.findMany({ where, orderBy: { nextRunAt: 'asc' }, skip: dto.skip ?? 0, take: dto.take ?? 50 }),
      this.tenantPrisma.client.reportSchedule.count({ where }),
    ]);
    return { items, total };
  }

  async createSchedule(user: AuthenticatedUser, dto: CreateReportScheduleDto) {
    this.assertKnownReportType(dto.reportType);
    this.assertScheduleTiming(dto.frequency, dto.dayOfWeek, dto.dayOfMonth);
    const template = dto.templateId ? await this.loadTemplate(dto.templateId, dto.reportType) : null;
    const access = await this.resolveAccess(user, dto.reportType);
    const nextRunAt = calculateNextRunAt({
      frequency: dto.frequency as DbReportScheduleFrequency,
      timeOfDay: dto.timeOfDay,
      timezone: dto.timezone,
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
    });
    try {
      return await this.untypedCreate().reportSchedule.create({
        data: {
          name: dto.name,
          reportType: dto.reportType as DbReportType,
          templateId: template?.id,
          createdById: user.id,
          frequency: dto.frequency as DbReportScheduleFrequency,
          format: dto.format as DbReportExportFormat,
          filters: this.json(dto.filters ?? {}),
          scopeSnapshot: this.json(this.snapshot(access)),
          timezone: dto.timezone,
          timeOfDay: dto.timeOfDay,
          dayOfWeek: dto.dayOfWeek ?? null,
          dayOfMonth: dto.dayOfMonth ?? null,
          nextRunAt,
          isActive: dto.isActive ?? true,
        },
      });
    } catch {
      throw new ConflictException('A schedule with that name already exists.');
    }
  }

  async updateSchedule(user: AuthenticatedUser, id: string, dto: UpdateReportScheduleDto) {
    const schedule = await this.findOwnedSchedule(user, id);
    const reportType = dto.reportType ?? schedule.reportType;
    this.assertKnownReportType(reportType);
    if (dto.frequency || dto.dayOfWeek !== undefined || dto.dayOfMonth !== undefined) {
      this.assertScheduleTiming(dto.frequency ?? schedule.frequency, dto.dayOfWeek ?? schedule.dayOfWeek, dto.dayOfMonth ?? schedule.dayOfMonth);
    }
    if (dto.templateId) await this.loadTemplate(dto.templateId, reportType);
    const access = await this.resolveAccess(user, reportType);
    const nextRunAt = calculateNextRunAt({
      frequency: (dto.frequency ?? schedule.frequency) as DbReportScheduleFrequency,
      timeOfDay: dto.timeOfDay ?? schedule.timeOfDay,
      timezone: dto.timezone ?? schedule.timezone,
      dayOfWeek: dto.dayOfWeek ?? schedule.dayOfWeek,
      dayOfMonth: dto.dayOfMonth ?? schedule.dayOfMonth,
    });
    return this.tenantPrisma.client.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.reportType ? { reportType: dto.reportType as DbReportType } : {}),
        ...(dto.templateId !== undefined ? { templateId: dto.templateId } : {}),
        ...(dto.format ? { format: dto.format as DbReportExportFormat } : {}),
        ...(dto.filters ? { filters: this.json(dto.filters) } : {}),
        ...(dto.frequency ? { frequency: dto.frequency as DbReportScheduleFrequency } : {}),
        ...(dto.timezone ? { timezone: dto.timezone } : {}),
        ...(dto.timeOfDay ? { timeOfDay: dto.timeOfDay } : {}),
        dayOfWeek: dto.dayOfWeek !== undefined ? dto.dayOfWeek : schedule.dayOfWeek,
        dayOfMonth: dto.dayOfMonth !== undefined ? dto.dayOfMonth : schedule.dayOfMonth,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        scopeSnapshot: this.json(this.snapshot(access)),
        nextRunAt,
      },
    });
  }

  async deleteSchedule(user: AuthenticatedUser, id: string) {
    const schedule = await this.findOwnedSchedule(user, id);
    await this.tenantPrisma.client.reportSchedule.delete({ where: { id: schedule.id } });
    return { deleted: true };
  }

  private async resolveTarget(user: AuthenticatedUser, dto: PreviewReportDto | CreateReportExportDto) {
    let savedReportId: string | undefined;
    let reportType = dto.reportType;
    let filters: ReportFilters = dto.filters ?? {};
    if (dto.savedReportId) {
      const saved = await this.tenantPrisma.client.savedReport.findFirst({ where: { id: dto.savedReportId } });
      if (!saved) throw new NotFoundException('Saved report not found.');
      if (!(await this.canUseSaved(user, saved.ownerId))) throw new ForbiddenException('This saved report belongs to another user.');
      savedReportId = saved.id;
      reportType = saved.reportType;
      filters = (saved.filters as ReportFilters | null) ?? {};
    }
    if (!reportType) throw new BadRequestException('reportType or savedReportId is required.');
    const definition = this.assertKnownReportType(reportType);
    const template = dto.templateId ? await this.loadTemplate(dto.templateId, definition.reportType) : null;
    return {
      reportType: definition.reportType,
      filters,
      template: template ? (template.definition as ReportTemplateDefinition) : null,
      templateId: template?.id,
      savedReportId,
    };
  }

  private async resolveAccess(user: AuthenticatedUser, reportType: string): Promise<EffectiveReportAccess> {
    const definition = this.assertKnownReportType(reportType);
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    const reportGrants = asReportScopeGrants(effective[REPORTS_VIEW] ?? []);
    const sourceGrants = asReportScopeGrants(effective[definition.sourcePermission] ?? []);
    if (!reportGrants.length) throw new ForbiddenException('Missing required permission: reports.view');
    if (!sourceGrants.length) throw new ForbiddenException(`Missing required permission: ${definition.sourcePermission}`);
    const merged = await intersectReportScope(this.tenantPrisma, reportGrants, sourceGrants);
    assertNonEmptyEffectiveScope(merged);
    return { reportGrants, sourceGrants, effectiveGrants: merged, sourcePermission: definition.sourcePermission, actorUserId: user.id };
  }

  private async loadTemplate(id: string, reportType: string) {
    const template = await this.tenantPrisma.client.reportTemplate.findFirst({ where: { id } });
    if (!template) throw new NotFoundException('Report template not found.');
    if (template.reportType !== reportType) throw new BadRequestException('The template does not belong to this report type.');
    return template;
  }

  private async findOwnedSaved(user: AuthenticatedUser, id: string) {
    const saved = await this.tenantPrisma.client.savedReport.findFirst({ where: { id } });
    if (!saved) throw new NotFoundException('Saved report not found.');
    if (saved.ownerId !== user.id && !(await this.hasManage(user))) throw new ForbiddenException('You cannot manage this saved report.');
    return saved;
  }

  private async findOwnedSchedule(user: AuthenticatedUser, id: string) {
    const schedule = await this.tenantPrisma.client.reportSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Report schedule not found.');
    if (schedule.createdById !== user.id && !(await this.hasManage(user))) throw new ForbiddenException('You cannot manage this schedule.');
    return schedule;
  }

  private async canUseSaved(user: AuthenticatedUser, ownerId: string): Promise<boolean> {
    return ownerId === user.id || this.hasManage(user);
  }

  private async hasManage(user: AuthenticatedUser): Promise<boolean> {
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    return Boolean(effective[REPORTS_MANAGE]?.length);
  }

  private assertKnownReportType(reportType: string) {
    const definition = getReportDefinition(reportType);
    if (!definition) throw new BadRequestException(`Unknown report type: ${reportType}`);
    return definition;
  }

  private validateTemplate(definition: ReportTemplateDefinition | undefined, reportType: string): void {
    if (!definition?.columns?.length) throw new BadRequestException('Template columns are required.');
    const report = this.assertKnownReportType(reportType);
    const allowed = new Set(report.columns.map((column) => column.key));
    const invalid = definition.columns.filter((column: { key: string }) => !allowed.has(column.key));
    if (invalid.length) {
      throw new BadRequestException(`Unknown template columns: ${invalid.map((column) => column.key).join(', ')}`);
    }
  }

  private assertScheduleTiming(frequency: string, dayOfWeek: number | null | undefined, dayOfMonth: number | null | undefined): void {
    if (frequency === 'WEEKLY' && dayOfWeek === null) throw new BadRequestException('dayOfWeek is required for weekly schedules.');
    if (frequency === 'MONTHLY' && dayOfMonth === null) throw new BadRequestException('dayOfMonth is required for monthly schedules.');
  }

  private snapshot(access: EffectiveReportAccess) {
    return {
      version: 1,
      reportPermission: REPORTS_VIEW,
      sourcePermission: access.sourcePermission,
      reportGrants: access.reportGrants,
      sourceGrants: access.sourceGrants,
      effectiveGrants: access.effectiveGrants,
      actorUserId: access.actorUserId,
      capturedAt: new Date().toISOString(),
    };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
  }

  private enginePrisma(): ReportPrisma {
    return this.tenantPrisma.client as unknown as ReportPrisma;
  }

  /** The tenant-scope extension injects tenantId at runtime, so Prisma's generated create-input
   * still requires it at compile time. Confine that one unavoidable cast here rather than casting
   * the whole client at every call site. */
  private untypedCreate(): UntypedCreateClient {
    return this.tenantPrisma.client as unknown as UntypedCreateClient;
  }

  private toRunView(run: { id: string; reportType: string; format: string; status: string; rowCount: number; fileName: string | null; errorMessage: string | null; createdAt: Date; completedAt: Date | null; expiresAt: Date | null }) {
    return {
      id: run.id,
      reportType: run.reportType,
      format: run.format,
      status: run.status,
      rowCount: run.rowCount,
      fileName: run.fileName,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      expiresAt: run.expiresAt,
    };
  }

  private contentType(format: string): string {
    if (format === 'CSV') return 'text/csv; charset=utf-8';
    if (format === 'EXCEL') return 'application/vnd.ms-excel';
    return 'application/pdf';
  }
}

export type { ReportFiltersDto };
