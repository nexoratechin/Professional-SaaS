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
import { CreateFeeHeadDto, ListFeeHeadQueryDto, UpdateFeeHeadDto } from './fees.dto';
import { FeeHeadsService } from './fee-heads.service';

@ApiTags('fees/heads')
@Controller('fees/heads')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeHeadsController {
  constructor(
    private readonly feeHeadsService: FeeHeadsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeHeadQueryDto) {
    return this.feeHeadsService.list(this.tid(), query);
  }

  @Get('archived')
  @RequirePermission(K.FEES_VIEW)
  listArchived(@Query() query: ListFeeHeadQueryDto) {
    return this.feeHeadsService.list(this.tid(), { ...query, includeArchived: true });
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeHeadsService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.FEES_CREATE)
  create(@Body() dto: CreateFeeHeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeHeadsService.create(this.tid(), user.id, dto);
  }

  @Patch(':id')
  @RequirePermission(K.FEES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateFeeHeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeHeadsService.update(this.tid(), user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission(K.FEES_MANAGE)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeHeadsService.archive(this.tid(), user.id, id);
  }
}