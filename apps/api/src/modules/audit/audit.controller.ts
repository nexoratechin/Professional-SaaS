import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSION_KEYS } from '@college-erp/auth';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { AuditService } from './audit.service';
import { ListAuditLogsDto, ListPlatformAuditLogsDto } from './dto/list-audit-logs.dto';

/** X-Total-Count carries the full matching row count for the searchable audit UI's pagination —
 * added as a header, not wrapped into the response body, so existing consumers of the plain
 * array body (e.g. the tenant-isolation e2e suite) keep working unchanged. */
@ApiTags('audit')
@Controller()
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('platform/audit-logs')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  async findAllPlatform(@Query() query: ListPlatformAuditLogsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.auditService.findAllPlatform(query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('tenant/audit-logs')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.AUDIT_VIEW)
  async findForTenant(@Query() query: ListAuditLogsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.auditService.findForTenant(this.tenantContext.tenantId as string, query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }
}
