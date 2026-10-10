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

  it('assertKeyInCategory accepts a key the feature itself issued', () => {
    const key = storage.buildKey(tenantA, 'imports', 'students.csv');
    expect(() => storage.assertKeyInCategory(tenantA, key, 'imports')).not.toThrow();
  });

  it('assertKeyInCategory rejects a key from a different category (cross-feature IDOR)', () => {
    const certificateKey = storage.buildKey(tenantA, 'certificates', 'CERT-2026-0001.pdf');
    expect(() => storage.assertKeyInCategory(tenantA, certificateKey, 'imports')).toThrow(ForbiddenException);
  });

  it("assertKeyInCategory still rejects another tenant's key", () => {
    const otherTenantKey = storage.buildKey(tenantB, 'document'.concat('s'), 'x.pdf');
    expect(() => storage.assertKeyInCategory(tenantA, otherTenantKey, 'documents')).toThrow(ForbiddenException);
  });

  describe('download response headers', () => {
    it('forces an attachment + neutral content type for client-declared HTML (stored XSS guard)', async () => {
      const key = storage.buildKey(tenantA, 'documents', 'evil.html');
      const url = await storage.getDownloadUrl(tenantA, key, { filename: 'evil.html', contentType: 'text/html' });
      const params = new URL(url).searchParams;
      expect(params.get('response-content-disposition')).toContain('attachment');
      expect(params.get('response-content-type')).toBe('application/octet-stream');
    });

    it('allows inline rendering only for a safe allowlisted content type', async () => {
      const key = storage.buildKey(tenantA, 'documents', 'doc.pdf');
      const url = await storage.getDownloadUrl(tenantA, key, { filename: 'doc.pdf', contentType: 'application/pdf' });
      const params = new URL(url).searchParams;
      expect(params.get('response-content-disposition')).toContain('inline');
      expect(params.get('response-content-type')).toBe('application/pdf');
    });

    it('sanitizes quotes/CRLF in the filename before building Content-Disposition', async () => {
      const key = storage.buildKey(tenantA, 'documents', 'x.pdf');
      const url = await storage.getDownloadUrl(tenantA, key, {
        filename: 'a"\r\nSet-Cookie: x=y.pdf',
        contentType: 'application/pdf',
      });
      // The raw dangerous characters must not survive into the header value.
      const disposition = new URL(url).searchParams.get('response-content-disposition') ?? '';
      expect(disposition).not.toContain('"'.repeat(2));
      expect(disposition).not.toContain('\n');
      expect(disposition).not.toContain('\r');
    });
  });
});
