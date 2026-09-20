import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K } from '@college-erp/auth';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { FeeReportsService } from './fee-reports.service';
import {
  CollectionsReportQueryDto,
  DemandStatusReportQueryDto,
  OutstandingReportQueryDto,
} from './fees.dto';

@ApiTags('fees/reports')
@Controller('fees/reports')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.FEES)
export class FeeReportsController {
  constructor(
    private readonly feeReportsService: FeeReportsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  @Get('outstanding')
  @RequirePermission(K.FEES_VIEW)
  outstanding(@Query() query: OutstandingReportQueryDto) {
    return this.feeReportsService.outstanding(this.tid(), query);
  }

  @Get('outstanding.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="outstanding.csv"')
  @RequirePermission(K.FEES_EXPORT)
  outstandingCsv(@Query() query: OutstandingReportQueryDto) {
    return this.feeReportsService.outstandingCsv(this.tid(), query);
  }

  @Get('collections')
  @RequirePermission(K.PAYMENTS_VIEW)
  collections(@Query() query: CollectionsReportQueryDto) {
    return this.feeReportsService.collections(this.tid(), query);
  }

  @Get('demand-status')
  @RequirePermission(K.FEES_VIEW)
  demandStatus(@Query() query: DemandStatusReportQueryDto) {
    return this.feeReportsService.demandStatus(this.tid(), query);
  }
}