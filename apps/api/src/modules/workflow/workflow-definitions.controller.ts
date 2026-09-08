import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

/** Configuration side of the engine — defining and (de)activating tenant-specific approval
 * chains. WORKFLOWS_MANAGE gates every mutation here; WORKFLOWS_VIEW is enough to read them. */
@ApiTags('workflows')
@Controller('workflows/definitions')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class WorkflowDefinitionsController {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_MANAGE)
  create(@Body() dto: CreateWorkflowDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.createDefinition(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  list(@Query('entityType') entityType?: string) {
    return this.definitions.listDefinitions(entityType);
  }

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_VIEW)
  get(@Param('id') id: string) {
    return this.definitions.getDefinition(id);
  }

  @Patch(':id/activate')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_MANAGE)
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.setActive(this.tenantContext.tenantId as string, id, true, user.id);
  }

  @Patch(':id/deactivate')
  @RequirePermission(PERMISSION_KEYS.WORKFLOWS_MANAGE)
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.setActive(this.tenantContext.tenantId as string, id, false, user.id);
  }
}
