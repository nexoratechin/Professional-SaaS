import { BadRequestException } from '@nestjs/common';
import type { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { BrandingService, brandingAssetPath } from './branding.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function makeService(overrides: {
  tenant?: { id: string; slug: string; name: string; status?: string } | null;
  config?: { version: number; data: unknown } | null;
  branding?: Record<string, unknown>;
} = {}) {
  const tenant = overrides.tenant !== undefined
    ? overrides.tenant
    : { id: TENANT, slug: 'stmarys', name: 'St Marys College', status: 'ACTIVE' };
  const config = overrides.config !== undefined ? overrides.config : { version: 3, data: { branding: overrides.branding ?? {} } };

  const platformPrisma = {
    client: {
      tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
      tenantConfiguration: { findUnique: jest.fn().mockResolvedValue(config) },
    },
  } as unknown as PlatformPrismaService;

  const tenantConfig = {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue({ version: 4 }),
  } as unknown as TenantConfigurationService;

  const storage = {
    buildKey: jest.fn().mockReturnValue(`tenants/${TENANT}/branding/uuid-logo.png`),
    getUploadUrl: jest.fn().mockResolvedValue('https://storage/put'),
    assertKeyInCategory: jest.fn(),
    assertKeyBelongsToTenant: jest.fn(),
    getObjectMetadata: jest.fn().mockResolvedValue({ sizeBytes: 1024, contentType: 'image/png', etag: 'e', lastModified: null }),
    downloadBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;

  return { service: new BrandingService(platformPrisma, tenantConfig, storage), tenantConfig, storage };
}

describe('BrandingService', () => {
  it('builds tenant-scoped asset paths', () => {
    expect(brandingAssetPath('st marys', 'logo')).toBe('/public/branding/st%20marys/assets/logo');
  });

  it('returns null for an unknown or suspended tenant', async () => {
    const missing = makeService({ tenant: null });
    expect(await missing.service.getPublicBySlug('nope')).toBeNull();

    const suspended = makeService({ tenant: { id: TENANT, slug: 's', name: 'S', status: 'SUSPENDED' } });
    expect(await suspended.service.getPublicBySlug('s')).toBeNull();
  });

  it('applies platform defaults and streams uploaded assets through the tenant path', async () => {
    const { service } = makeService({
      branding: {
        collegeName: 'St Marys College',
        logoKey: `tenants/${TENANT}/branding/uuid-logo.png`,
      },
    });
    const branding = await service.getPublicBySlug('stmarys');
    expect(branding).not.toBeNull();
    expect(branding!.portalName).toBe('St Marys College');
    expect(branding!.primaryColor).toBe('#1d4ed8');
    expect(branding!.logoUrl).toBe(brandingAssetPath('stmarys', 'logo'));
    expect(branding!.login.title).toBe('St Marys College');
  });

  it('prefers the portal name over the college name when both are set', async () => {
    const { service } = makeService({ branding: { collegeName: 'St Marys College', portalName: 'SM Portal' } });
    const branding = await service.getPublicBySlug('stmarys');
    expect(branding!.portalName).toBe('SM Portal');
    expect(branding!.collegeName).toBe('St Marys College');
  });

  it('rejects unsupported asset types', async () => {
    const { service } = makeService();
    await expect(
      service.createUploadUrl(TENANT, 'logo', { filename: 'x.svg', mimeType: 'image/svg+xml' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('confirms an asset only under the tenant branding category', async () => {
    const { service, storage, tenantConfig } = makeService();
    await service.confirmAsset(TENANT, 'logo', `tenants/${TENANT}/branding/uuid-logo.png`);
    expect(storage.assertKeyInCategory).toHaveBeenCalledWith(TENANT, `tenants/${TENANT}/branding/uuid-logo.png`, 'branding');
    expect(tenantConfig.update).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ branding: expect.objectContaining({ logoKey: expect.any(String) }) }),
      'system:branding',
    );
  });

  it('rejects confirming a key outside the tenant prefix', async () => {
    const { service, storage } = makeService();
    (storage.assertKeyInCategory as jest.Mock).mockImplementation(() => {
      throw new BadRequestException('This file does not belong to your tenant.');
    });
    await expect(
      service.confirmAsset(TENANT, 'logo', `tenants/other/branding/uuid-logo.png`),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
