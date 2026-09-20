import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { FeePaymentsService } from './fee-payments.service';
import { ListFeePaymentQueryDto, RecordFeePaymentDto } from './fees.dto';

@ApiTags('fees/payments')
@Controller('fees/payments')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.PAYMENTS)
export class FeePaymentsController {
  constructor(
    private readonly feePaymentsService: FeePaymentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.PAYMENTS_VIEW)
  list(@Query() query: ListFeePaymentQueryDto) {
    return this.feePaymentsService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.PAYMENTS_VIEW)
  get(@Param('id') id: string) {
    return this.feePaymentsService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.PAYMENTS_CREATE)
  record(@Body() dto: RecordFeePaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feePaymentsService.record(this.tid(), user.id, dto);
  }
}