import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { FeeAssignmentsService } from './fee-assignments.service';
import { CreateFeeAssignmentDto, ListFeeAssignmentQueryDto } from './fees.dto';

@ApiTags('fees/assignments')
@Controller('fees/assignments')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeAssignmentsController {
  constructor(
    private readonly feeAssignmentsService: FeeAssignmentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeAssignmentQueryDto) {
    return this.feeAssignmentsService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeAssignmentsService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.FEES_CREATE)
  create(@Body() dto: CreateFeeAssignmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeAssignmentsService.create(this.tid(), user.id, dto);
  }

  @Patch(':id/revoke')
  @RequirePermission(K.FEES_UPDATE)
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeAssignmentsService.revoke(this.tid(), user.id, id);
  }
}