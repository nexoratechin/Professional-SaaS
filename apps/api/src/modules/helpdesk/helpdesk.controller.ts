/**
 * Helpdesk / Feedback controller. Guards follow the feature-module convention:
 * configuration (departments/categories/SLA policies) and the SLA sweep require HELPDESK_MANAGE;
 * ticket mutations require HELPDESK_UPDATE, ticket creation/raising HELPDESK_CREATE, and reads
 * HELPDESK_VIEW. Static sub-routes ('lookups', 'reports/*', 'sla/sweep', 'tickets/mine') are
 * declared before parameter routes so NestJS never treats them as an :id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { HelpdeskConfigService } from './helpdesk-config.service';
import { HelpdeskReportService } from './helpdesk-report.service';
import { HelpdeskTicketService } from './helpdesk-ticket.service';
import {
  AddHelpdeskAttachmentDto,
  AddHelpdeskCommentDto,
  AssignHelpdeskTicketDto,
  ChangeHelpdeskTicketStatusDto,
  CreateHelpdeskCategoryDto,
  CreateHelpdeskDepartmentDto,
  CreateHelpdeskSlaPolicyDto,
  CreateHelpdeskTicketDto,
  EscalateHelpdeskTicketDto,
  HelpdeskPaginationDto,
  HelpdeskReportQueryDto,
  ListHelpdeskTicketsDto,
  ReopenHelpdeskTicketDto,
  ResolveHelpdeskTicketDto,
  SubmitHelpdeskFeedbackDto,
  UpdateHelpdeskCategoryDto,
  UpdateHelpdeskDepartmentDto,
  UpdateHelpdeskSlaPolicyDto,
  UpdateHelpdeskTicketDto,
} from './dto/helpdesk.dto';

@ApiTags('helpdesk')
@Controller('helpdesk')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.HELPDESK)
export class HelpdeskController {
  constructor(
    private readonly tickets: HelpdeskTicketService,
    private readonly config: HelpdeskConfigService,
    private readonly reports: HelpdeskReportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups & dashboards ──────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.HELPDESK_VIEW)
  lookups() {
    return this.config.lookups(this.tid());
  }

  @Get('summary')
  @RequirePermission(K.HELPDESK_VIEW)
  summary(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.summary(this.tid(), q);
  }

  @Get('reports/summary')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsSummary(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.summary(this.tid(), q);
  }

  @Get('reports/departments')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsDepartments(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.byDepartment(this.tid(), q);
  }

  @Get('reports/categories')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsCategories(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.byCategory(this.tid(), q);
  }

  @Get('reports/agents')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsAgents(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.byAgent(this.tid(), q);
  }

  @Get('reports/trend')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsTrend(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.trend(this.tid(), q);
  }

  @Get('reports/satisfaction')
  @RequirePermission(K.HELPDESK_VIEW)
  reportsSatisfaction(@Query() q: HelpdeskReportQueryDto) {
    return this.reports.satisfaction(this.tid(), q);
  }

  @Post('sla/sweep')
  @RequirePermission(K.HELPDESK_MANAGE)
  sweep(@CurrentUser() user: AuthenticatedUser) {
    return this.tickets.sweepSla(this.tid(), user.id);
  }

  // ── Departments ───────────────────────────────────────────────────────────

  @Get('departments')
  @RequirePermission(K.HELPDESK_VIEW)
  listDepartments(@Query() q: HelpdeskPaginationDto) {
    return this.config.listDepartments(this.tid(), q);
  }

  @Post('departments')
  @RequirePermission(K.HELPDESK_MANAGE)
  createDepartment(@Body() dto: CreateHelpdeskDepartmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.createDepartment(this.tid(), user.id, dto);
  }

  @Patch('departments/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  updateDepartment(@Param('id') id: string, @Body() dto: UpdateHelpdeskDepartmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.updateDepartment(this.tid(), user.id, id, dto);
  }

  @Delete('departments/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  deleteDepartment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.config.deleteDepartment(this.tid(), user.id, id);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermission(K.HELPDESK_VIEW)
  listCategories(@Query() q: HelpdeskPaginationDto) {
    return this.config.listCategories(this.tid(), q);
  }

  @Post('categories')
  @RequirePermission(K.HELPDESK_MANAGE)
  createCategory(@Body() dto: CreateHelpdeskCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.createCategory(this.tid(), user.id, dto);
  }

  @Patch('categories/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  updateCategory(@Param('id') id: string, @Body() dto: UpdateHelpdeskCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.updateCategory(this.tid(), user.id, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  deleteCategory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.config.deleteCategory(this.tid(), user.id, id);
  }

  // ── SLA policies ──────────────────────────────────────────────────────────

  @Get('sla-policies')
  @RequirePermission(K.HELPDESK_VIEW)
  listSlaPolicies(@Query() q: HelpdeskPaginationDto) {
    return this.config.listSlaPolicies(this.tid(), q);
  }

  @Post('sla-policies')
  @RequirePermission(K.HELPDESK_MANAGE)
  createSlaPolicy(@Body() dto: CreateHelpdeskSlaPolicyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.createSlaPolicy(this.tid(), user.id, dto);
  }

  @Patch('sla-policies/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  updateSlaPolicy(@Param('id') id: string, @Body() dto: UpdateHelpdeskSlaPolicyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.config.updateSlaPolicy(this.tid(), user.id, id, dto);
  }

  @Delete('sla-policies/:id')
  @RequirePermission(K.HELPDESK_MANAGE)
  deleteSlaPolicy(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.config.deleteSlaPolicy(this.tid(), user.id, id);
  }

  // ── Tickets ───────────────────────────────────────────────────────────────

  @Get('tickets')
  @RequirePermission(K.HELPDESK_VIEW)
  listTickets(@Query() q: ListHelpdeskTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.list(this.tid(), user.id, q);
  }

  @Get('tickets/mine')
  @RequirePermission(K.HELPDESK_VIEW)
  listMyTickets(@Query() q: ListHelpdeskTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.listMine(this.tid(), user.id, q);
  }

  @Post('tickets')
  @RequirePermission(K.HELPDESK_CREATE)
  createTicket(@Body() dto: CreateHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.create(this.tid(), user.id, dto);
  }

  @Get('tickets/:id')
  @RequirePermission(K.HELPDESK_VIEW)
  getTicket(@Param('id') id: string) {
    return this.tickets.get(this.tid(), id);
  }

  @Patch('tickets/:id')
  @RequirePermission(K.HELPDESK_UPDATE)
  updateTicket(@Param('id') id: string, @Body() dto: UpdateHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.update(this.tid(), user.id, id, dto);
  }

  @Delete('tickets/:id')
  @RequirePermission(K.HELPDESK_DELETE)
  deleteTicket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.remove(this.tid(), user.id, id);
  }

  @Post('tickets/:id/assign')
  @RequirePermission(K.HELPDESK_UPDATE)
  assignTicket(@Param('id') id: string, @Body() dto: AssignHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.assign(this.tid(), user.id, id, dto);
  }

  @Post('tickets/:id/status')
  @RequirePermission(K.HELPDESK_UPDATE)
  changeStatus(@Param('id') id: string, @Body() dto: ChangeHelpdeskTicketStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.changeStatus(this.tid(), user.id, id, dto);
  }

  @Post('tickets/:id/resolve')
  @RequirePermission(K.HELPDESK_UPDATE)
  resolveTicket(@Param('id') id: string, @Body() dto: ResolveHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.resolve(this.tid(), user.id, id, dto);
  }

  @Post('tickets/:id/close')
  @RequirePermission(K.HELPDESK_UPDATE)
  closeTicket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.close(this.tid(), user.id, id);
  }

  @Post('tickets/:id/reopen')
  @RequirePermission(K.HELPDESK_UPDATE)
  reopenTicket(@Param('id') id: string, @Body() dto: ReopenHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.reopen(this.tid(), user.id, id, dto);
  }

  @Post('tickets/:id/cancel')
  @RequirePermission(K.HELPDESK_UPDATE)
  cancelTicket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.cancel(this.tid(), user.id, id);
  }

  @Post('tickets/:id/escalate')
  @RequirePermission(K.HELPDESK_UPDATE)
  escalateTicket(@Param('id') id: string, @Body() dto: EscalateHelpdeskTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.escalate(this.tid(), user.id, id, dto);
  }

  @Get('tickets/:id/workflow')
  @RequirePermission(K.HELPDESK_VIEW)
  getTicketWorkflow(@Param('id') id: string) {
    return this.tickets.getWorkflow(this.tid(), id);
  }

  @Get('tickets/:id/comments')
  @RequirePermission(K.HELPDESK_VIEW)
  listComments(@Param('id') id: string) {
    return this.tickets.listComments(this.tid(), id, true);
  }

  @Post('tickets/:id/comments')
  @RequirePermission(K.HELPDESK_CREATE)
  addComment(@Param('id') id: string, @Body() dto: AddHelpdeskCommentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.addComment(this.tid(), user.id, id, dto);
  }

  @Get('tickets/:id/attachments')
  @RequirePermission(K.HELPDESK_VIEW)
  listAttachments(@Param('id') id: string) {
    return this.tickets.listAttachments(this.tid(), id);
  }

  @Post('tickets/:id/attachments')
  @RequirePermission(K.HELPDESK_UPDATE)
  addAttachment(@Param('id') id: string, @Body() dto: AddHelpdeskAttachmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.addAttachment(this.tid(), user.id, id, dto);
  }

  @Delete('tickets/:id/attachments/:attachmentId')
  @RequirePermission(K.HELPDESK_UPDATE)
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.removeAttachment(this.tid(), user.id, id, attachmentId);
  }

  @Get('tickets/:id/history')
  @RequirePermission(K.HELPDESK_VIEW)
  listHistory(@Param('id') id: string) {
    return this.tickets.listHistory(this.tid(), id);
  }

  @Get('tickets/:id/escalations')
  @RequirePermission(K.HELPDESK_VIEW)
  listEscalations(@Param('id') id: string) {
    return this.tickets.listEscalations(this.tid(), id);
  }

  @Post('tickets/:id/feedback')
  @RequirePermission(K.HELPDESK_CREATE)
  submitFeedback(@Param('id') id: string, @Body() dto: SubmitHelpdeskFeedbackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.submitFeedback(this.tid(), user.id, id, dto);
  }
}
