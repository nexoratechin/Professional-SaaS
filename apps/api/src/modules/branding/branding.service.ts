import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BrandingAssetDto, BrandingAssetKind, PublicTenantBrandingDto, TenantConfigBranding } from '@college-erp/types';
import type { UpdateTenantConfigurationDto } from '../tenant-configuration/dto/update-tenant-configuration.dto';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';

export const BRANDING_ASSET_KINDS: readonly BrandingAssetKind[] = ['logo', 'favicon', 'loginBackground'];

/** Max decoded size of a branding asset (2 MiB) — logos/favicons are small by nature. */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ALLOWED_ASSET_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const DEFAULT_PRIMARY = '#1d4ed8';
const DEFAULT_SECONDARY = '#0f172a';

/** Maps an asset kind to the configuration branding key that stores its storage key. */
const KEY_FIELD: Record<BrandingAssetKind, keyof TenantConfigBranding> = {
  logo: 'logoKey',
  favicon: 'faviconKey',
  loginBackground: 'loginBackgroundKey',
};

const URL_FIELD: Record<BrandingAssetKind, keyof TenantConfigBranding> = {
  logo: 'logoUrl',
  favicon: 'faviconUrl',
  loginBackground: 'loginBackgroundUrl',
};

/** The stored public path for a streamed branding asset. Kept relative so the web app can prefix
 * its configured API origin; the tenant slug is in the path so an <img>/favicon request (which
 * cannot carry an X-Tenant-Slug header) still resolves the correct tenant. */
export function brandingAssetPath(slug: string, kind: BrandingAssetKind): string {
  return `/public/branding/${encodeURIComponent(slug)}/assets/${kind}`;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * White-label tenant branding.
 *
 * The configuration itself lives in the existing TenantConfiguration JSONB document (the `branding`
 * section) — no new table and no migration, consistent with the configuration engine's design.
 * This service adds the two things the document alone cannot provide:
 *  1. a public, tenant-resolved projection of the visual identity for pre-auth surfaces (the login
 *     page, favicon, emails), with sane platform defaults; and
 *  2. tenant-scoped asset handling (logo / favicon / login background) on top of the shared
 *     StorageService, where every key is validated to belong to the calling tenant.
 *
 * Tenant isolation: every write goes through TenantConfigurationService (keyed by tenantId) and
 * every storage key is asserted under `tenants/{tenantId}/branding/…`, so a tenant can never read
 * or reference another tenant's assets. The public projection is resolved from the tenant slug, so
 * one tenant's branding can never leak into another's page.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantConfig: TenantConfigurationService,
    // StorageService is provided by the global StorageModule.
    private readonly storage: StorageService,
  ) {}

  /** Extracts the `branding` section from a configuration document (`data` JSONB). */
  private brandingSection(raw: unknown): Partial<TenantConfigBranding> {
    const data = (raw ?? {}) as Record<string, unknown>;
    return (data.branding ?? {}) as Partial<TenantConfigBranding>;
  }

  /** Resolves the public, defaults-applied branding projection for one tenant. */
  private project(
    tenant: { id: string; slug: string; name: string },
    config: { version: number; data: unknown } | null,
  ): PublicTenantBrandingDto {
    const branding = this.brandingSection(config?.data);
    const portalName = firstNonEmpty(branding.portalName, branding.collegeName, tenant.name) ?? tenant.name;
    const collegeName = firstNonEmpty(branding.collegeName, tenant.name) ?? tenant.name;

    const logoUrl = branding.logoKey
      ? brandingAssetPath(tenant.slug, 'logo')
      : firstNonEmpty(branding.logoUrl);
    const faviconUrl = branding.faviconKey
      ? brandingAssetPath(tenant.slug, 'favicon')
      : firstNonEmpty(branding.faviconUrl);
    const backgroundUrl = branding.loginBackgroundKey
      ? brandingAssetPath(tenant.slug, 'loginBackground')
      : firstNonEmpty(branding.loginBackgroundUrl);

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      version: config?.version ?? 0,
      portalName,
      collegeName,
      tagline: firstNonEmpty(branding.tagline),
      primaryColor: isHexColor(branding.primaryColor) ? branding.primaryColor : DEFAULT_PRIMARY,
      secondaryColor: isHexColor(branding.secondaryColor) ? branding.secondaryColor : DEFAULT_SECONDARY,
      accentColor: isHexColor(branding.accentColor) ? branding.accentColor : null,
      logoUrl,
      faviconUrl,
      login: {
        title: firstNonEmpty(branding.loginTitle, portalName) ?? portalName,
        subtitle: firstNonEmpty(branding.loginSubtitle, branding.tagline),
        welcomeText: firstNonEmpty(branding.loginWelcomeText),
        backgroundColor: isHexColor(branding.loginBackgroundColor) ? branding.loginBackgroundColor : null,
        backgroundUrl,
      },
    };
  }

  /** Public resolution by tenant slug — the one unscoped lookup a pre-auth surface legitimately
   *  needs. Returns null (404 at the controller) for unknown/suspended/canceled tenants. */
  async getPublicBySlug(slug: string): Promise<PublicTenantBrandingDto | null> {
    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELED') {
      return null;
    }
    const config = await this.platformPrisma.client.tenantConfiguration.findUnique({ where: { tenantId: tenant.id } });
    return this.project({ id: tenant.id, slug: tenant.slug, name: tenant.name }, config);
  }

  /** Authenticated projection for the current tenant (branding admin preview). */
  async getForCurrentTenant(tenantId: string, tenantSlug: string): Promise<PublicTenantBrandingDto> {
    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    const config = await this.platformPrisma.client.tenantConfiguration.findUnique({ where: { tenantId } });
    return this.project({ id: tenant.id, slug: tenantSlug, name: tenant.name }, config);
  }

  // ── Asset management ───────────────────────────────────────────────────────

  async createUploadUrl(
    tenantId: string,
    kind: BrandingAssetKind,
    input: { filename: string; mimeType: string },
  ) {
    this.assertKind(kind);
    this.assertAssetType(input.mimeType);
    const storageKey = this.storage.buildKey(tenantId, 'branding', input.filename);
    const uploadUrl = await this.storage.getUploadUrl(tenantId, storageKey, input.mimeType);
    return { kind, storageKey, uploadUrl, expiresInSeconds: 300 };
  }

  async confirmAsset(
    tenantId: string,
    kind: BrandingAssetKind,
    storageKey: string,
  ): Promise<BrandingAssetDto> {
    this.assertKind(kind);
    // The key must live under THIS tenant's branding category — laser-focused proof the caller was
    // issued a URL for this exact class of object, not merely that the bytes belong to their tenant.
    this.storage.assertKeyInCategory(tenantId, storageKey, 'branding');

    const metadata = await this.storage.getObjectMetadata(tenantId, storageKey).catch(() => {
      throw new BadRequestException('The uploaded asset could not be found in storage.');
    });
    if (metadata.contentType && !ALLOWED_ASSET_TYPES.has(metadata.contentType.split(';')[0]!.trim().toLowerCase())) {
      throw new BadRequestException('Only PNG, JPEG, WebP or GIF images are allowed.');
    }
    if (metadata.sizeBytes > MAX_ASSET_BYTES) {
      throw new BadRequestException(`Branding assets must be ${MAX_ASSET_BYTES / (1024 * 1024)} MiB or smaller.`);
    }

    await this.tenantConfig.update(
      tenantId,
      { branding: { [KEY_FIELD[kind]]: storageKey } } as unknown as UpdateTenantConfigurationDto,
      'system:branding',
    );

    return {
      kind,
      storageKey,
      url: brandingAssetPath(await this.slugFor(tenantId), kind),
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
    };
  }

  async removeAsset(tenantId: string, kind: BrandingAssetKind, actorUserId: string): Promise<{ success: true }> {
    this.assertKind(kind);
    const { config } = await this.tenantConfig.get(tenantId);
    const branding = this.brandingSection(config);
    const existingKey = branding[KEY_FIELD[kind]] as string | null | undefined;

    await this.tenantConfig.update(
      tenantId,
      { branding: { [KEY_FIELD[kind]]: '', [URL_FIELD[kind]]: '' } } as unknown as UpdateTenantConfigurationDto,
      actorUserId,
    );

    if (existingKey && typeof existingKey === 'string' && existingKey.startsWith('tenants/')) {
      await this.storage.delete(tenantId, existingKey).catch(() => undefined);
    }
    return { success: true };
  }

  /** Streams a stored branding asset for public (pre-auth) consumption, tenant resolved by slug. */
  async readAssetBySlug(slug: string, kind: BrandingAssetKind): Promise<{ buffer: Buffer; contentType: string } | null> {
    this.assertKind(kind);
    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELED') return null;

    const config = await this.platformPrisma.client.tenantConfiguration.findUnique({ where: { tenantId: tenant.id } });
    const branding = this.brandingSection(config?.data);
    const key = branding[KEY_FIELD[kind]] as string | null | undefined;
    if (!key || typeof key !== 'string' || key.trim().length === 0) return null;

    // Defense in depth: even though the key was written by this tenant's own confirm, re-assert it
    // under their prefix before reading bytes out of shared storage.
    this.storage.assertKeyBelongsToTenant(tenant.id, key);
    const [buffer, metadata] = await Promise.all([
      this.storage.downloadBuffer(tenant.id, key),
      this.storage.getObjectMetadata(tenant.id, key).catch(() => null),
    ]);
    const rawType = (metadata?.contentType ?? '').split(';')[0]!.trim().toLowerCase();
    const contentType = ALLOWED_ASSET_TYPES.has(rawType) ? rawType : 'application/octet-stream';
    return { buffer, contentType };
  }

  private async slugFor(tenantId: string): Promise<string> {
    const tenant = await this.platformPrisma.client.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    return tenant.slug;
  }

  private assertKind(kind: string): asserts kind is BrandingAssetKind {
    if (!BRANDING_ASSET_KINDS.includes(kind as BrandingAssetKind)) {
      throw new BadRequestException(`Unknown branding asset "${kind}".`);
    }
  }

  private assertAssetType(mimeType: string): void {
    const normalized = mimeType.split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_ASSET_TYPES.has(normalized)) {
      throw new BadRequestException('Only PNG, JPEG, WebP or GIF images are allowed.');
    }
  }
}
