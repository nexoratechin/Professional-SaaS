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
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { InvoicesService } from './invoices.service';

/** Mixes platform control-plane routes (generate/void/mark-paid — PLATFORM_ADMIN only) with one
 * tenant self-service read route (GET /tenant/invoices) — same mixed-controller pattern as
 * TenantsController, since Invoice always carries an explicit tenantId either way. */
@ApiTags('billing')
@Controller()
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('subscriptions/:subscriptionId/invoices')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  generate(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: GenerateInvoiceDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.invoicesService.generateForSubscription(subscriptionId, dto, platformUser.id);
  }

  @Get('tenants/:tenantId/invoices')
  @UseGuards(PlatformAuthGuard)
  async listForTenantPlatformSide(
    @Param('tenantId') tenantId: string,
    @Query() query: ListInvoicesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, total } = await this.invoicesService.listForTenant(tenantId, query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('invoices')
  @UseGuards(PlatformAuthGuard)
  async listAll(@Query() query: ListInvoicesDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.invoicesService.listAll(query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('invoices/:id')
  @UseGuards(PlatformAuthGuard)
  get(@Param('id') id: string) {
    return this.invoicesService.getInvoice(id);
  }

  @Get('invoices/:id/pdf')
  @UseGuards(PlatformAuthGuard)
  generatePdf(@Param('id') id: string) {
    return this.invoicesService.getInvoicePdfUrl(id);
  }

  @Post('invoices/:id/mark-paid')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  markPaid(@Param('id') id: string, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.invoicesService.markPaid(id, platformUser.id);
  }

  @Post('invoices/:id/void')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  voidInvoice(@Param('id') id: string, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.invoicesService.voidInvoice(id, platformUser.id);
  }

  // --- Tenant self-service -----------------------------------------------------------------

  @Get('tenant/invoices')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_BILLING_VIEW)
  async listOwnInvoices(@Query() query: ListInvoicesDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.invoicesService.listForTenant(this.tenantContext.tenantId as string, query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('tenant/invoices/:id/pdf')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_BILLING_VIEW)
  generateOwnPdf(@Param('id') id: string) {
    return this.invoicesService.getTenantInvoicePdfUrl(this.tenantContext.tenantId as string, id);
  }
}
