import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { FeeStructuresService } from './fee-structures.service';
import {
  CreateFeeStructureDto,
  ListFeeStructureQueryDto,
  PreviewStructureDto,
  UpdateFeeStructureDto,
} from './fees.dto';

@ApiTags('fees/structures')
@Controller('fees/structures')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeStructuresController {
  constructor(
    private readonly feeStructuresService: FeeStructuresService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeStructureQueryDto) {
    return this.feeStructuresService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeStructuresService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.FEES_CREATE)
  create(@Body() dto: CreateFeeStructureDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeStructuresService.create(this.tid(), user.id, dto);
  }

  @Patch(':id')
  @RequirePermission(K.FEES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateFeeStructureDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeStructuresService.update(this.tid(), user.id, id, dto);
  }

  @Post(':id/activate')
  @RequirePermission(K.FEES_UPDATE)
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeStructuresService.activate(this.tid(), user.id, id);
  }

  @Get(':id/preview')
  @RequirePermission(K.FEES_VIEW)
  previewStructure(@Param('id') id: string, @Query() query: PreviewStructureDto) {
    return this.feeStructuresService.preview(this.tid(), id, query);
  }

  @Delete(':id')
  @RequirePermission(K.FEES_MANAGE)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeStructuresService.archive(this.tid(), user.id, id);
  }
}