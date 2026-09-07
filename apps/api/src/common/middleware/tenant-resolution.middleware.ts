import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { TenantLookupService } from '../tenant/tenant-lookup.service';
import type { RequestWithTenant } from '../types/tenant-request';

/**
 * Resolves the tenant for every request in the tenant realm (production: subdomain; local
 * dev/CI: X-Tenant-Slug header, gated by TENANT_HEADER_FALLBACK) and rejects suspended/canceled
 * tenants before any auth/business logic runs. Registered against all routes except /health,
 * /api/docs, and /platform/** (see AppModule#configure) — the platform control plane has no
 * tenant to resolve.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantLookup: TenantLookupService,
    private readonly config: AppConfigService,
  ) {}

  async use(req: RequestWithTenant, _res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = this.extractTenantSlug(req);
      if (!slug) {
        throw new NotFoundException('Tenant could not be determined from the request.');
      }

      const tenant = await this.tenantLookup.findBySlug(slug);
      if (!tenant) {
        throw new NotFoundException('Unknown tenant.');
      }
      if (tenant.status === 'SUSPENDED' || tenant.status === 'CANCELED') {
        throw new ForbiddenException(`Tenant is ${tenant.status.toLowerCase()}.`);
      }

      req.resolvedTenant = tenant;
      next();
    } catch (error) {
      next(error);
    }
  }

  private extractTenantSlug(req: RequestWithTenant): string | null {
    if (this.config.get('TENANT_HEADER_FALLBACK')) {
      const header = req.header('X-Tenant-Slug');
      if (header) {
        return header;
      }
    }

    const host = req.hostname;
    const subdomain = host?.split('.')[0];
    return subdomain && subdomain !== 'www' && subdomain !== 'localhost' ? subdomain : null;
  }
}
