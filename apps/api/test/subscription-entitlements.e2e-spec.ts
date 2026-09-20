import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

describe('Subscription lifecycle + entitlements (e2e)', () => {
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

  async function createTestPlan(featureKeys: string[]) {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const res = await request(app.getHttpServer())
      .post('/plans')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ code: `test-plan-${suffix}`, name: `Test Plan ${suffix}`, priceCents: 100000, featureKeys })
      .expect(201);
    return res.body;
  }

  it('materializes PLAN-sourced entitlements on subscribe and self-heals on suspend/reactivate', async () => {
    const plan = await createTestPlan(['admissions']);
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const subRes = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: plan.code, billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);
    const subscriptionId = subRes.body.id;

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const entitlementsAfterSubscribe = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(entitlementsAfterSubscribe.body.some((e: { key: string; source: string }) => e.key === 'admissions' && e.source === 'PLAN')).toBe(true);

    // SUSPENDED is not an entitled status — recompute must clear the PLAN-sourced grant.
    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/suspend`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'non-payment' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    // Reactivating restores it.
    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/activate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .get('/tenant/demo/admissions-gate')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('rejects an illegal subscription status transition (CANCELED is terminal)', async () => {
    const plan = await createTestPlan([]);
    const tenant = await provisionTenant(app, platformToken);

    const subRes = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: plan.code, billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);
    const subscriptionId = subRes.body.id;

    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/cancel`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/activate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(400);
  });

  it('grants an ADDON_MODULE subscription item as a SUBSCRIPTION_ITEM entitlement, removable on delete', async () => {
    const plan = await createTestPlan([]);
    const tenant = await provisionTenant(app, platformToken);

    const subRes = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: plan.code, billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);
    const subscriptionId = subRes.body.id;

    const itemRes = await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/items`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ itemType: 'ADDON_MODULE', description: 'Library add-on', moduleKey: 'library', unitPriceCents: 20000 })
      .expect(201);

    const afterAdd = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(
      afterAdd.body.some((e: { key: string; source: string }) => e.key === 'library' && e.source === 'SUBSCRIPTION_ITEM'),
    ).toBe(true);

    await request(app.getHttpServer())
      .delete(`/subscription-items/${itemRes.body.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    const afterRemove = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(afterRemove.body.some((e: { key: string }) => e.key === 'library')).toBe(false);
  });

  it('applies a QUANTITY plan-module across every tenant subscribed to that plan, without a deploy', async () => {
    const plan = await createTestPlan([]);
    const tenant = await provisionTenant(app, platformToken);

    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: plan.code, billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/plans/${plan.id}/modules`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ modules: [{ moduleKey: 'max_campuses', name: 'Max Campuses', type: 'QUANTITY', limitValue: 5 }] })
      .expect(200);

    const entitlements = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    const maxCampuses = entitlements.body.find((e: { key: string }) => e.key === 'max_campuses');
    expect(maxCampuses).toBeDefined();
    expect(maxCampuses.type).toBe('QUANTITY');
    expect(maxCampuses.limitValue).toBe(5);
  });

  it('lets a manual tenant entitlement override survive a subsequent recompute', async () => {
    const plan = await createTestPlan([]);
    const tenant = await provisionTenant(app, platformToken);

    const subRes = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId: tenant.tenant.id, planCode: plan.code, billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);
    const subscriptionId = subRes.body.id;

    await request(app.getHttpServer())
      .patch(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ key: 'max_campuses', type: 'QUANTITY', limitValue: 25, reason: 'negotiated custom pricing' })
      .expect(200);

    // Adding a subscription item triggers EntitlementsService.recompute for this tenant — the
    // override for 'max_campuses' must not be clobbered by it.
    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/items`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ itemType: 'CUSTOM', description: 'Negotiated add-on', unitPriceCents: 5000 })
      .expect(201);

    const entitlements = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    const override = entitlements.body.find((e: { key: string }) => e.key === 'max_campuses');
    expect(override).toBeDefined();
    expect(override.source).toBe('TENANT_OVERRIDE');
    expect(override.limitValue).toBe(25);

    await request(app.getHttpServer())
      .post(`/tenants/${tenant.tenant.id}/entitlements/max_campuses/remove-override`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(201);

    const afterRemoval = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/entitlements`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(afterRemoval.body.some((e: { key: string }) => e.key === 'max_campuses')).toBe(false);
  });
});
