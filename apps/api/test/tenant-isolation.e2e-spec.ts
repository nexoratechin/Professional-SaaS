import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a tenant admin to access their own tenant', async () => {
    const tenantA = await provisionTenant(app, platformToken);
    const tokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);

    await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });

  it('rejects a JWT whose tenantId does not match the resolved tenant, and audits the attempt', async () => {
    const tenantA = await provisionTenant(app, platformToken);
    const tenantB = await provisionTenant(app, platformToken);
    const tokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);

    await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    const auditRes = await request(app.getHttpServer())
      .get('/platform/audit-logs')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ tenantId: tenantB.tenant.id, take: 10 })
      .expect(200);

    const hasCrossTenantEntry = (auditRes.body as Array<{ action: string }>).some(
      (entry) => entry.action === 'CROSS_TENANT_ACCESS_ATTEMPT',
    );
    expect(hasCrossTenantEntry).toBe(true);
  });

  it('rejects an unknown tenant slug', async () => {
    await request(app.getHttpServer())
      .get('/tenant/settings')
      .set('X-Tenant-Slug', 'does-not-exist-tenant')
      .set('Authorization', 'Bearer irrelevant')
      .expect(404);
  });
});
