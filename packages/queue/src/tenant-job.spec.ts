import { requireTenantId } from './tenant-job';

describe('requireTenantId', () => {
  it('returns the tenant id from the job payload', () => {
    expect(requireTenantId({ name: 'deliver', data: { tenantId: 'tenant-1' } })).toBe('tenant-1');
  });

  it('throws for a missing, empty, or non-string tenant id', () => {
    expect(() => requireTenantId({ name: 'deliver', data: undefined })).toThrow(/missing tenantId/i);
    expect(() => requireTenantId({ name: 'deliver', data: { tenantId: '' } })).toThrow(/missing tenantId/i);
    expect(() =>
      requireTenantId({ name: 'deliver', data: { tenantId: 7 as unknown as string } }),
    ).toThrow(/missing tenantId/i);
  });
});
