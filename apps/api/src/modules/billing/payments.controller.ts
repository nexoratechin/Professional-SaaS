import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { ListPaymentsDto, RecordPaymentDto } from './dto/list-payments.dto';
import { PaymentsService } from './payments.service';

/** Payments: platform control-plane (record/refund/list/summary) + tenant self-service reads. */
@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('invoices/:invoiceId/payments')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  record(@Param('invoiceId') invoiceId: string, @Body() dto: RecordPaymentDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.paymentsService.recordPayment(invoiceId, dto, platformUser.id);
  }

  @Post('payments/:id/refund')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  refund(@Param('id') id: string, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.paymentsService.refundPayment(id, platformUser.id);
  }

  @Get('payments')
  @UseGuards(PlatformAuthGuard)
  async list(@Query() query: ListPaymentsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.paymentsService.listPayments(query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('billing/summary')
  @UseGuards(PlatformAuthGuard)
  summary() {
    return this.paymentsService.getBillingSummary();
  }

  @Get('tenant/payments')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_BILLING_VIEW)
  async listOwnPayments(@Query() query: ListPaymentsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.paymentsService.listTenantPayments(this.tenantContext.tenantId as string, query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  /** Combined tenant self-service billing view: subscription + invoices + payments + config. */
  @Get('tenant/billing')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_BILLING_VIEW)
  overview() {
    return this.paymentsService.getTenantBillingOverview(this.tenantContext.tenantId as string);
  }
}