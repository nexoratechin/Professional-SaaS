/**
 * Bulk import/export routes.
 *
 * The entity is a route param, so the actual RBAC check is performed at runtime by the service
 * against each registry entity's view/import permission (the same pattern the organization
 * module uses) rather than a static @RequirePermission. Every route is still behind the standard
 * JwtAuthGuard + TenantMatchGuard + PermissionsGuard stack, and every mutation is audited.
 */
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import {
  CreateImportJobDto,
  ExportEntityDto,
  ListImportJobsDto,
  ListImportRowsDto,
  PreviewImportDto,
  SaveImportTemplateDto,
  UploadUrlDto,
} from './dto/import-export.dto';
import { ImportExportService } from './import-export.service';

@ApiTags('imports')
@Controller('imports')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class ImportExportController {
  constructor(
    private readonly service: ImportExportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Metadata ────────────────────────────────────────────────────────────────

  @Get('entities')
  entities() {
    return { entities: this.service.listEntities() };
  }

  @Get('entities/:entity/template')
  template(
    @Param('entity') entity: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.downloadTemplate(this.tid(), user.id, entity, format === 'XLSX' ? 'XLSX' : 'CSV');
  }

  @Get('entities/:entity/export')
  exportEntity(
    @Param('entity') entity: string,
    @Query() query: ExportEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.exportEntity(this.tid(), user.id, entity, query);
  }

  // ── Saved mappings ──────────────────────────────────────────────────────────

  @Get('templates')
  listTemplates(@CurrentUser() user: AuthenticatedUser, @Query('entity') entity?: string) {
    return this.service.listTemplates(this.tid(), user.id, entity);
  }

  @Post('templates')
  saveTemplate(@Body() dto: SaveImportTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.saveTemplate(this.tid(), user.id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteTemplate(this.tid(), user.id, id);
  }

  // ── History / detail (static routes before the :entity upload/preview/jobs) ──

  @Get('jobs')
  listJobs(@Query() query: ListImportJobsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listJobs(this.tid(), user.id, query);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string, @Query() query: ListImportRowsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getJob(this.tid(), user.id, id, query);
  }

  @Get('jobs/:id/errors')
  downloadErrors(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.downloadErrors(this.tid(), user.id, id, format === 'XLSX' ? 'XLSX' : 'CSV');
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.retryJob(this.tid(), user.id, id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancelJob(this.tid(), user.id, id);
  }

  // ── Upload / preview / create job ───────────────────────────────────────────

  @Post(':entity/upload-url')
  uploadUrl(@Param('entity') entity: string, @Body() dto: UploadUrlDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.requestUploadUrl(this.tid(), user.id, entity, dto);
  }

  @Post(':entity/preview')
  preview(@Param('entity') entity: string, @Body() dto: PreviewImportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.preview(this.tid(), user.id, entity, dto);
  }

  @Post(':entity/jobs')
  createJob(@Param('entity') entity: string, @Body() dto: CreateImportJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createJob(this.tid(), user.id, entity, dto);
  }
}
