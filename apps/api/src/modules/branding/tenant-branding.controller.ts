import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import type { BrandingAssetKind } from '@college-erp/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { BrandingService } from './branding.service';
import { ConfirmBrandingAssetDto, RequestBrandingAssetUploadDto } from './dto/branding.dto';

/**
 * Tenant self-service white-label branding. Reads/writes use the same TENANT_CONFIG_VIEW/MANAGE
 * grants as the configuration engine (branding is a section of that document). Asset uploads are
 * presigned exactly like the documents module: request URL → browser PUT → confirm, so file bytes
 * never transit the API.
 */
@ApiTags('branding')
@Controller('tenant/branding')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class TenantBrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_VIEW)
  @ApiOperation({ summary: "The current tenant's resolved branding (visual identity)." })
  get() {
    return this.branding.getForCurrentTenant(
      this.tenantContext.tenantId as string,
      this.tenantContext.tenantSlug as string,
    );
  }

  @Post('assets/upload-url')
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_MANAGE)
  @ApiOperation({ summary: 'Request a presigned upload URL for a branding asset.' })
  requestUpload(@Body() dto: RequestBrandingAssetUploadDto) {
    return this.branding.createUploadUrl(this.tenantContext.tenantId as string, dto.kind, dto);
  }

  @Post('assets/:kind/confirm')
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_MANAGE)
  @ApiOperation({ summary: 'Confirm a finished branding asset upload and persist its storage key.' })
  confirm(@Param('kind') kind: BrandingAssetKind, @Body() dto: ConfirmBrandingAssetDto) {
    return this.branding.confirmAsset(this.tenantContext.tenantId as string, kind, dto.storageKey);
  }

  @Delete('assets/:kind')
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_MANAGE)
  @ApiOperation({ summary: 'Remove a tenant branding asset (reverts to the platform default).' })
  remove(@Param('kind') kind: BrandingAssetKind, @CurrentUser() user: AuthenticatedUser) {
    return this.branding.removeAsset(this.tenantContext.tenantId as string, kind, user.id);
  }
}
