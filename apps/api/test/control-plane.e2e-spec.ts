import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { platformPrismaClient } from '@college-erp/database';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant, PLATFORM_ADMIN_EMAIL } from './utils/platform-admin.util';

/**
 * Covers the SaaS control plane built in this task: tenant search/usage/lifecycle, plan +
 * feature-flag catalog CRUD, billing (subscriptions -> invoices), support tickets (dual-realm),
 * platform system health/dashboard, and the PLATFORM_ADMIN-vs-PLATFORM_SUPPORT role boundary —
 * plus a concrete check that the tenant- and platform-realm refresh cookies no longer collide
 * (see refresh-cookie.util.ts's fix). A PLATFORM_SUPPORT fixture user is created directly via
 * platformPrismaClient (there is no "create platform user" API — out of scope for this task, see
 * its summary); every ASSERTION below still goes through the real HTTP API.
 */
describe('SaaS control plane (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tenant and platform logins set distinct, non-colliding refresh cookies', async () => {
    const tenant = await provisionTenant(app, platformToken);

    const tenantLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant-Slug', tenant.slug)
      .send({ email: tenant.adminEmail, password: tenant.adminPassword })
      .expect(200);
    const platformLoginRes = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe123!' })
      .expect(200);

    const tenantSetCookie = String(tenantLoginRes.headers['set-cookie']);
    const platformSetCookie = String(platformLoginRes.headers['set-cookie']);
    expect(tenantSetCookie).toContain('refresh_token=');
    expect(tenantSetCookie).toContain('Path=/auth');
    expect(platformSetCookie).toContain('platform_refresh_token=');
    expect(platformSetCookie).toContain('Path=/platform/auth');
    // Different names AND different paths — a browser holding both never confuses one for the other.
    expect(tenantSetCookie).not.toContain('platform_refresh_token=');
  });

  it('searches tenants by slug/name and reports total via X-Total-Count', async () => {
    const tenant = await provisionTenant(app, platformToken);

    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ q: tenant.slug, take: 10 })
      .expect(200);

    expect(res.headers['x-total-count']).toBeDefined();
    expect((res.body as Array<{ slug: string }>).some((t) => t.slug === tenant.slug)).toBe(true);
  });

  it('enforces the tenant lifecycle state machine (activate/suspend/deactivate)', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const tenantId = tenant.tenant.id;

    // Fresh tenant starts TRIAL — cannot suspend-then-activate-then-suspend illegally, but CAN
    // go TRIAL -> ACTIVE.
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/activate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/deactivate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'test cleanup' })
      .expect(201);

    // CANCELED is terminal — activating it back is illegal.
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/activate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(400);
  });

  it("reports a tenant's usage (active users, proxy student count, storage)", async () => {
    const tenant = await provisionTenant(app, platformToken);

    const res = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/usage`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      totalUsers: expect.any(Number),
      activeUsers: expect.any(Number),
      studentCount: expect.any(Number),
      storageUsedBytes: expect.any(Number),
    });
  });

  it('creates and updates a plan, including its feature grants', async () => {
    const code = `TEST_PLAN_${Date.now()}`;
    const createRes = await request(app.getHttpServer())
      .post('/plans')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ code, name: 'Test Plan', priceCents: 10000, featureKeys: ['students'] })
      .expect(201);
    expect(createRes.body.planFeatures).toHaveLength(1);

    const updateRes = await request(app.getHttpServer())
      .patch(`/plans/${createRes.body.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: false })
      .expect(200);
    expect(updateRes.body.isActive).toBe(false);
  });

  it('creates a feature flag and toggles it', async () => {
    const key = `test_flag_${Date.now()}`;
    const createRes = await request(app.getHttpServer())
      .post('/feature-flags')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ key, name: 'Test Flag', module: 'reports' })
      .expect(201);

    const updateRes = await request(app.getHttpServer())
      .patch(`/feature-flags/${createRes.body.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: false })
      .expect(200);
    expect(updateRes.body.isActive).toBe(false);
  });

  it('bills a subscription: generate an invoice, then mark it paid (and reject a second mark-paid)', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const now = new Date();
    const oneYearOut = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

    // Seeded plans (see packages/database/prisma/seed.ts) have no priceCents set — create a
    // priced plan here so the invoice actually has something billable to compute.
    const planRes = await request(app.getHttpServer())
      .post('/plans')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ code: `BILLING_TEST_PLAN_${Date.now()}`, name: 'Billing Test Plan', priceCents: 50000 })
      .expect(201);

    const subscriptionRes = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        tenantId: tenant.tenant.id,
        planCode: planRes.body.code,
        billingCycle: 'ANNUAL',
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: oneYearOut.toISOString(),
      })
      .expect(201);

    const invoiceRes = await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionRes.body.id}/invoices`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({})
      .expect(201);
    expect(invoiceRes.body.status).toBe('ISSUED');
    expect(invoiceRes.body.totalCents).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/invoices/${invoiceRes.body.id}/mark-paid`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/invoices/${invoiceRes.body.id}/mark-paid`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(400);

    const tenantInvoicesRes = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenant.id}/invoices`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(tenantInvoicesRes.body.some((invoice: { id: string }) => invoice.id === invoiceRes.body.id)).toBe(true);
  });

  it('handles a support ticket end to end: tenant raises it, platform comments and resolves it', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const tenantToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const createRes = await request(app.getHttpServer())
      .post('/tenant/support/tickets')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${tenantToken}`)
      .send({ subject: 'Cannot upload documents', description: 'Getting a 500 error.' })
      .expect(201);

    const platformListRes = await request(app.getHttpServer())
      .get('/platform/support/tickets')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ tenantId: tenant.tenant.id })
      .expect(200);
    expect(platformListRes.body.some((ticket: { id: string }) => ticket.id === createRes.body.id)).toBe(true);

    await request(app.getHttpServer())
      .post(`/platform/support/tickets/${createRes.body.id}/comments`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ body: 'Looking into this now.' })
      .expect(201);

    const updateRes = await request(app.getHttpServer())
      .patch(`/platform/support/tickets/${createRes.body.id}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ status: 'RESOLVED' })
      .expect(200);
    expect(updateRes.body.status).toBe('RESOLVED');
    expect(updateRes.body.resolvedAt).not.toBeNull();

    const tenantDetailRes = await request(app.getHttpServer())
      .get(`/tenant/support/tickets/${createRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(200);
    expect(tenantDetailRes.body.comments).toHaveLength(1);
  });

  it("rejects a tenant user viewing another tenant user's support ticket", async () => {
    const tenantA = await provisionTenant(app, platformToken);
    const tenantB = await provisionTenant(app, platformToken);
    const tokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);
    const tokenB = await loginAsTenantUser(app, tenantB.slug, tenantB.adminEmail, tenantB.adminPassword);

    const createRes = await request(app.getHttpServer())
      .post('/tenant/support/tickets')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ subject: 'Billing question', description: 'Why was I charged twice?' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/tenant/support/tickets/${createRes.body.id}`)
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('reports platform system health and a cross-tenant dashboard summary', async () => {
    const healthRes = await request(app.getHttpServer())
      .get('/platform/system/health')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(healthRes.body.database.ok).toBe(true);
    expect(healthRes.body.redis.ok).toBe(true);

    const summaryRes = await request(app.getHttpServer())
      .get('/platform/dashboard/summary')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);
    expect(summaryRes.body.totalTenants).toBeGreaterThan(0);
  });

  it('lets PLATFORM_SUPPORT read tenants but rejects it from tenant lifecycle mutations', async () => {
    const suffix = Date.now();
    const supportEmail = `support-${suffix}@college-erp.local`;
    const supportPassword = 'SupportPassw0rd!';
    await platformPrismaClient.platformUser.create({
      data: {
        email: supportEmail,
        passwordHash: await bcrypt.hash(supportPassword, 12),
        fullName: 'Support Staff',
        role: 'PLATFORM_SUPPORT',
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/platform/auth/login')
      .send({ email: supportEmail, password: supportPassword })
      .expect(200);
    const supportToken = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(200);

    const tenant = await provisionTenant(app, platformToken);
    await request(app.getHttpServer())
      .post(`/tenants/${tenant.tenant.id}/suspend`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({})
      .expect(403);
  });
});
