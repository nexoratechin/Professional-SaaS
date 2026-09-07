import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

describe('Feature flags / subscription gating (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function subscriptionPeriod() {
    const start = new Date();
    const end = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
    return { currentPeriodStart: start.toISOString(), currentPeriodEnd: end.toISOString() };
  }

  it('blocks a module with no active subscription, then unblocks it when the plan includes it', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: 'professional', billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('lets a tenant feature-flag override unblock a module the plan does not include, without a deploy', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: 'starter', billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/tenants/${tenant.tenant.id}/features`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ featureKey: 'admissions', enabled: true, reason: 'pilot trial' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
