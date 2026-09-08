import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { DecideTaskDto } from './dto/decide-task.dto';
import { ResubmitInstanceDto } from './dto/resubmit-instance.dto';
import { StartWorkflowInstanceDto } from './dto/start-workflow-instance.dto';
import { WorkflowEngineService } from './workflow-engine.service';

/**
 * Runtime side of the engine. Deliberately entityType-agnostic — a future business module (fee
 * refunds, admissions, leave, …) calls POST /workflows/instances with its own entityType and a
 * context payload instead of this controller knowing anything about that domain. WORKFLOWS_VIEW
 * gates starting/reading/resubmitting/cancelling an instance (every default role that would ever
 * need to submit a request already holds it — see DEFAULT_ROLE_DEFINITIONS); the real
 * "may this user request a fee refund at all" business check belongs to that future module,
 * called before it ever reaches here. WORKFLOWS_APPROVE gates acting on tasks.
 */
@ApiTags('workflows')
@Controller('workflows')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class WorkflowInstancesController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('instances')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  start(@Body() dto: StartWorkflowInstanceDto, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithTenant) {
    return this.engine.startInstance(this.tenantContext.tenantId as string, dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('instances')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  find(@Query('entityType') entityType: string, @Query('entityId') entityId: string) {
    return this.engine.findInstance(this.tenantContext.tenantId as string, entityType, entityId);
  }

  @Get('instances/:id')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  get(@Param('id') id: string) {
    return this.engine.getInstance(this.tenantContext.tenantId as string, id);
  }

  @Post('instances/:id/resubmit')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  resubmit(
    @Param('id') id: string,
    @Body() dto: ResubmitInstanceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithTenant,
  ) {
    return this.engine.resubmit(this.tenantContext.tenantId as string, id, dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('instances/:id/cancel')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithTenant) {
    return this.engine.cancel(this.tenantContext.tenantId as string, id, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('my-tasks')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_APPROVE)
  myTasks(@CurrentUser() user: AuthenticatedUser) {
    return this.engine.listMyTasks(this.tenantContext.tenantId as string, user.id);
  }

  @Post('tasks/:taskId/decide')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_APPROVE)
  decide(
    @Param('taskId') taskId: string,
    @Body() dto: DecideTaskDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithTenant,
  ) {
    return this.engine.decide(this.tenantContext.tenantId as string, taskId, dto, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
