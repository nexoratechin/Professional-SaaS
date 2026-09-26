import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import {
  CreateReportExportDto,
  CreateReportScheduleDto,
  CreateReportTemplateDto,
  CreateSavedReportDto,
  ListReportRunsDto,
  ListReportSchedulesDto,
  ListReportTemplatesDto,
  ListSavedReportsDto,
  PreviewReportDto,
  UpdateReportScheduleDto,
  UpdateReportTemplateDto,
  UpdateSavedReportDto,
} from './dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.REPORTS)
@RequirePermission(PERMISSION_KEYS.REPORTS_VIEW)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.catalog(user);
  }

  @Get('options')
  options(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.options(user);
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewReportDto) {
    return this.reports.preview(user, dto);
  }

  @Post('exports')
  @RequirePermission(PERMISSION_KEYS.REPORTS_EXPORT)
  exportReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportExportDto) {
    return this.reports.createExport(user, dto);
  }

  @Get('runs')
  runs(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListReportRunsDto) {
    return this.reports.listRuns(user, dto);
  }

  @Get('runs/:id/download')
  @RequirePermission(PERMISSION_KEYS.REPORTS_EXPORT)
  download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.downloadRun(user, id);
  }

  @Get('saved')
  listSaved(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListSavedReportsDto) {
    return this.reports.listSaved(user, dto);
  }

  @Post('saved')
  createSaved(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSavedReportDto) {
    return this.reports.createSaved(user, dto);
  }

  @Patch('saved/:id')
  updateSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSavedReportDto) {
    return this.reports.updateSaved(user, id, dto);
  }

  @Delete('saved/:id')
  deleteSaved(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.deleteSaved(user, id);
  }

  @Get('templates')
  listTemplates(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListReportTemplatesDto) {
    return this.reports.listTemplates(user, dto);
  }

  @Post('templates')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_TEMPLATE_CREATED', 'ReportTemplate', 'reports')
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportTemplateDto) {
    return this.reports.createTemplate(user, dto);
  }

  @Patch('templates/:id')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_TEMPLATE_UPDATED', 'ReportTemplate', 'reports')
  updateTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateReportTemplateDto) {
    return this.reports.updateTemplate(user, id, dto);
  }

  @Delete('templates/:id')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_TEMPLATE_DELETED', 'ReportTemplate', 'reports')
  deleteTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.deleteTemplate(user, id);
  }

  @Get('schedules')
  listSchedules(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListReportSchedulesDto) {
    return this.reports.listSchedules(user, dto);
  }

  @Post('schedules')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_SCHEDULE_CREATED', 'ReportSchedule', 'reports')
  createSchedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportScheduleDto) {
    return this.reports.createSchedule(user, dto);
  }

  @Patch('schedules/:id')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_SCHEDULE_UPDATED', 'ReportSchedule', 'reports')
  updateSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateReportScheduleDto) {
    return this.reports.updateSchedule(user, id, dto);
  }

  @Delete('schedules/:id')
  @RequirePermission(PERMISSION_KEYS.REPORTS_MANAGE)
  @Audit('REPORT_SCHEDULE_DELETED', 'ReportSchedule', 'reports')
  deleteSchedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.deleteSchedule(user, id);
  }
}
