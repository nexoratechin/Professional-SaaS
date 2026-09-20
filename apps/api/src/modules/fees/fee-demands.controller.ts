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
import { FeeDemandsService } from './fee-demands.service';
import { AccrueLateFeeDto, ListFeeDemandQueryDto } from './fees.dto';

@ApiTags('fees/demands')
@Controller('fees/demands')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeDemandsController {
  constructor(
    private readonly feeDemandsService: FeeDemandsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeDemandQueryDto) {
    return this.feeDemandsService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeDemandsService.get(this.tid(), id);
  }

  @Post('accrue')
  @RequirePermission(K.FEES_UPDATE)
  accrue(@Body() dto: AccrueLateFeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeDemandsService.accrueLateFees(this.tid(), user.id, dto);
  }
}