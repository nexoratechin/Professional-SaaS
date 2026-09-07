import { ForbiddenException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service';
import { StorageService } from './storage.service';

function fakeConfig(): AppConfigService {
  const values: Record<string, unknown> = {
    S3_BUCKET: 'test-bucket',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
  };
  return { get: (key: string) => values[key] } as unknown as AppConfigService;
}

// Presigning a URL is a pure local SigV4 computation — no network call reaches MinIO/S3 — so
// these run fully offline and still meaningfully prove the tenant-prefix enforcement.
describe('StorageService tenant isolation', () => {
  const storage = new StorageService(fakeConfig());
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('builds keys scoped under the tenant prefix', () => {
    const key = storage.buildKey(tenantA, 'documents', 'report.pdf');
    expect(key.startsWith(`tenants/${tenantA}/documents/`)).toBe(true);
    expect(key.endsWith('report.pdf')).toBe(true);
  });

  it('allows signing a download URL for a key under the caller\'s own tenant prefix', async () => {
    const key = storage.buildKey(tenantA, 'documents', 'report.pdf');
    await expect(storage.getDownloadUrl(tenantA, key)).resolves.toEqual(expect.any(String));
  });

  it("refuses to sign a download URL for another tenant's key", async () => {
    const otherTenantKey = storage.buildKey(tenantB, 'documents', 'secret.pdf');
    await expect(storage.getDownloadUrl(tenantA, otherTenantKey)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses to sign an upload URL for another tenant's key", async () => {
    const otherTenantKey = storage.buildKey(tenantB, 'documents', 'secret.pdf');
    await expect(storage.getUploadUrl(tenantA, otherTenantKey, 'application/pdf')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses to delete another tenant's key", async () => {
    const otherTenantKey = storage.buildKey(tenantB, 'documents', 'secret.pdf');
    await expect(storage.delete(tenantA, otherTenantKey)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
