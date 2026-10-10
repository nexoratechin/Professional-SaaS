import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { BrandingAssetKind } from '@college-erp/types';
import { BrandingService } from './branding.service';

/**
 * Public, tenant-resolved branding for pre-authentication surfaces (the login page, favicon and
 * email clients). Excluded from TenantResolutionMiddleware (see AppModule.configure): the tenant
 * slug is part of the URL, which is the only way an <img>/favicon request — one that cannot carry
 * an X-Tenant-Slug header — can identify its tenant. Only the visual identity is ever returned;
 * sender identity, email templates and generated-document settings stay behind authentication.
 *
 * Tenant isolation: the slug resolves to exactly one tenant id and every asset key is re-asserted
 * under that tenant's storage prefix before bytes are read, so no request can read another
 * tenant's asset.
 */
@ApiTags('public-branding')
@Controller('public/branding')
export class PublicBrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Public white-label branding for a tenant by slug.' })
  async get(@Param('slug') slug: string) {
    const branding = await this.branding.getPublicBySlug(slug);
    if (!branding) throw new NotFoundException('Branding not found for this tenant.');
    return branding;
  }

  @Get(':slug/assets/:kind')
  @ApiOperation({ summary: 'Stream a tenant branding image asset (public).' })
  async asset(
    @Param('slug') slug: string,
    @Param('kind') kind: BrandingAssetKind,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.branding.readAssetBySlug(slug, kind);
    if (!asset) throw new NotFoundException('Branding asset not found.');
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(asset.buffer);
  }
}
