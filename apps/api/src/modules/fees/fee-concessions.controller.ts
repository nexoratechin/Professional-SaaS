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
import { FeeConcessionsService } from './fee-concessions.service';
import { CreateFeeConcessionDto, DecideConcessionDto, ListFeeConcessionQueryDto } from './fees.dto';

@ApiTags('fees/concessions')
@Controller('fees/concessions')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeConcessionsController {
  constructor(
    private readonly feeConcessionsService: FeeConcessionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get()
  @RequirePermission(K.FEES_VIEW)
  list(@Query() query: ListFeeConcessionQueryDto) {
    return this.feeConcessionsService.list(this.tid(), query);
  }

  @Get(':id')
  @RequirePermission(K.FEES_VIEW)
  get(@Param('id') id: string) {
    return this.feeConcessionsService.get(this.tid(), id);
  }

  @Post()
  @RequirePermission(K.FEES_CREATE)
  request(@Body() dto: CreateFeeConcessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeConcessionsService.request(this.tid(), user.id, dto);
  }

  @Patch(':id/decide')
  @RequirePermission(K.FEES_UPDATE)
  decide(@Param('id') id: string, @Body() dto: DecideConcessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.feeConcessionsService.decide(this.tid(), user.id, id, dto);
  }

  @Patch(':id/revoke')
  @RequirePermission(K.FEES_MANAGE)
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.feeConcessionsService.revoke(this.tid(), user.id, id);
  }
}