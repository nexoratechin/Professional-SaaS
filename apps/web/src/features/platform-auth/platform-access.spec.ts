import {
  PLATFORM_SECTIONS,
  canAccessPlatformPath,
  canAccessPlatformSection,
  isPlatformAdmin,
  isPlatformRole,
  platformSectionForPath,
  visiblePlatformSections,
} from './platform-access';

describe('platform access policy', () => {
  it('gives PLATFORM_ADMIN every section', () => {
    const keys = visiblePlatformSections('PLATFORM_ADMIN').map((section) => section.key);
    expect(keys).toEqual(PLATFORM_SECTIONS.map((section) => section.key));
  });

  it('limits PLATFORM_SUPPORT to read-only triage sections', () => {
    const keys = visiblePlatformSections('PLATFORM_SUPPORT').map((section) => section.key);
    expect(keys).toEqual(['dashboard', 'analytics', 'tenants', 'support']);
    expect(keys).not.toContain('billing');
    expect(keys).not.toContain('catalog');
    expect(keys).not.toContain('audit-log');
  });

  it('fails closed for a missing or unknown role', () => {
    expect(visiblePlatformSections(null)).toEqual([]);
    expect(visiblePlatformSections(undefined)).toEqual([]);
    expect(visiblePlatformSections('SUPERUSER' as never)).toEqual([]);
    expect(canAccessPlatformSection(null, 'dashboard')).toBe(false);
    expect(canAccessPlatformSection('PLATFORM_SUPPORT', 'not-a-section' as never)).toBe(false);
  });

  it('classifies roles', () => {
    expect(isPlatformAdmin('PLATFORM_ADMIN')).toBe(true);
    expect(isPlatformAdmin('PLATFORM_SUPPORT')).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformRole('PLATFORM_SUPPORT')).toBe(true);
    expect(isPlatformRole('tenant_user')).toBe(false);
  });

  describe('path resolution', () => {
    it('maps exact and nested paths to their section', () => {
      expect(platformSectionForPath('/platform/tenants')?.key).toBe('tenants');
      expect(platformSectionForPath('/platform/tenants/new')?.key).toBe('tenants');
      expect(platformSectionForPath('/platform/tenants/abc-123')?.key).toBe('tenants');
      expect(platformSectionForPath('/platform/audit-log')?.key).toBe('audit-log');
    });

    it('normalises trailing slashes and an empty path', () => {
      expect(platformSectionForPath('/platform/billing/')?.key).toBe('billing');
      expect(platformSectionForPath('/platform')?.key).toBe('dashboard');
    });

    it('returns undefined for paths outside the platform area', () => {
      expect(platformSectionForPath('/dashboard')).toBeUndefined();
      expect(platformSectionForPath('/platform/does-not-exist')).toBeUndefined();
    });
  });

  describe('canAccessPlatformPath', () => {
    it('blocks support from admin-only pages', () => {
      expect(canAccessPlatformPath('PLATFORM_SUPPORT', '/platform/billing')).toBe(false);
      expect(canAccessPlatformPath('PLATFORM_SUPPORT', '/platform/catalog')).toBe(false);
      expect(canAccessPlatformPath('PLATFORM_SUPPORT', '/platform/audit-log')).toBe(false);
    });

    it('allows admin everywhere and support on triage pages', () => {
      expect(canAccessPlatformPath('PLATFORM_ADMIN', '/platform/billing')).toBe(true);
      expect(canAccessPlatformPath('PLATFORM_SUPPORT', '/platform/dashboard')).toBe(true);
      expect(canAccessPlatformPath('PLATFORM_SUPPORT', '/platform/tenants/abc-123')).toBe(true);
    });

    it('denies unknown paths even for admin', () => {
      expect(canAccessPlatformPath('PLATFORM_ADMIN', '/platform/nope')).toBe(false);
    });
  });
});
