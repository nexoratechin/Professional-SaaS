import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { ListSecurityEventsDto } from './dto/list-security-events.dto';
import { SecurityEventsService } from './security-events.service';

@ApiTags('security')
@Controller('tenant/security-events')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class SecurityEventsController {
  constructor(
    private readonly securityEventsService: SecurityEventsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.SECURITY_EVENTS_VIEW)
  list(@Query() query: ListSecurityEventsDto) {
    return this.securityEventsService.findForTenant(this.tenantContext.tenantId as string, query);
  }
}
