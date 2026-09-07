import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
  findAllPlatform(@Query() query: ListPlatformAuditLogsDto) {
    return this.auditService.findAllPlatform(query);
  }

  @Get('tenant/audit-logs')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.AUDIT_VIEW)
  findForTenant(@Query() query: ListAuditLogsDto) {
    return this.auditService.findForTenant(this.tenantContext.tenantId as string, query);
  }
}
