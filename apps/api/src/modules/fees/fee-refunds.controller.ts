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
import { FeeRefundsService } from './fee-refunds.service';
import {
  CreateFeeRefundDto,
  DecideRefundDto,
  ListFeeRefundQueryDto,
  ProcessRefundDto,
} from './fees.dto';

@ApiTags('fees/refunds')
@Controller('fees/refunds')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeRefundsController {
  constructor(
    private readonly feeRefundsService: FeeRefundsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeRefundQueryDto) {
    return this.feeRefundsService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeRefundsService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.FEES_REFUND)
  request(@Body() dto: CreateFeeRefundDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeRefundsService.request(this.tid(), user.id, dto);
  }

  @Patch(':id/decide')
  @RequirePermission(K.FEES_REFUND)
  decide(@Param('id') id: string, @Body() dto: DecideRefundDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeRefundsService.decide(this.tid(), user.id, id, dto);
  }

  @Patch(':id/process')
  @RequirePermission(K.FEES_MANAGE)
  process(@Param('id') id: string, @Body() dto: ProcessRefundDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeRefundsService.process(this.tid(), user.id, id, dto);
  }
}