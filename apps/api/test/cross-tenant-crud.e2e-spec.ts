import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

/**
 * IDOR-style cross-tenant attacks: the attacker is fully, legitimately authenticated against
 * their OWN tenant (valid JWT, correct subdomain/header — TenantMatchGuard passes) and simply
 * references another tenant's entity id in the URL. This is what the tenant-guard Prisma
 * extension (packages/database/src/client.ts) exists to stop at the query layer, independently
 * of any guard: the auto-scoped WHERE clause means a cross-tenant id just isn't found. Every
 * case here must fail as a 404 (or a guarded 403 pre-lookup), never a 200 with someone else's
 * data and never a 500 that might leak details.
 */
describe('Cross-tenant CRUD (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setUpTwoTenants() {
    const tenantA = await provisionTenant(app, platformToken);
    const tenantB = await provisionTenant(app, platformToken);
    const tokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);
    const tokenB = await loginAsTenantUser(app, tenantB.slug, tenantB.adminEmail, tenantB.adminPassword);

    const meB = await request(app.getHttpServer())
      .get('/auth/me')
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    return { tenantA, tenantB, tokenA, tokenB, tenantBAdminUserId: meB.body.id as string };
  }

  it('cross-tenant READ: tenant A cannot fetch tenant B\'s user by id', async () => {
    const { tenantA, tokenA, tenantBAdminUserId } = await setUpTwoTenants();

    await request(app.getHttpServer())
      .get(`/users/${tenantBAdminUserId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('cross-tenant UPDATE: tenant A cannot change tenant B\'s user status', async () => {
    const { tenantA, tenantB, tokenA, tokenB, tenantBAdminUserId } = await setUpTwoTenants();

    await request(app.getHttpServer())
      .patch(`/users/${tenantBAdminUserId}/status`)
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'SUSPENDED' })
      .expect(404);

    // Prove it actually had no effect: tenant B's own admin is still ACTIVE and can still act.
    const stillActive = await request(app.getHttpServer())
      .get(`/users/${tenantBAdminUserId}`)
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(stillActive.body.status).toBe('ACTIVE');
  });

  it('cross-tenant role assignment: tenant A cannot assign tenant B\'s role id to its own user', async () => {
    const { tenantA, tenantB, tokenA, tokenB } = await setUpTwoTenants();

    const rolesB = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const tenantBAdminRoleId = (rolesB.body as Array<{ id: string; code: string }>).find(
      (role) => role.code === 'TENANT_ADMIN',
    )!.id;

    const meA = await request(app.getHttpServer())
      .get('/auth/me')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/users/${meA.body.id}/roles/${tenantBAdminRoleId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('cross-tenant DELETE: tenant A cannot unassign a role grant belonging to tenant B', async () => {
    const { tenantA, tenantB, tokenA, tokenB, tenantBAdminUserId } = await setUpTwoTenants();

    const rolesB = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const tenantBAdminRoleId = (rolesB.body as Array<{ id: string; code: string }>).find(
      (role) => role.code === 'TENANT_ADMIN',
    )!.id;

    await request(app.getHttpServer())
      .delete(`/users/${tenantBAdminUserId}/roles/${tenantBAdminRoleId}`)
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('cross-tenant file access: tenant B cannot get a download URL for tenant A\'s document', async () => {
    const { tenantA, tenantB, tokenA, tokenB } = await setUpTwoTenants();

    const uploadRes = await request(app.getHttpServer())
      .post('/documents/upload-url')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'transcript.pdf', mimeType: 'application/pdf', category: 'transcripts' })
      .expect(201);
    const documentId = uploadRes.body.document.id as string;

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/download-url`)
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // Owning tenant can still fetch it — proves the 404 above is tenant isolation, not a bug.
    await request(app.getHttpServer())
      .get(`/documents/${documentId}/download-url`)
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });

  it('cross-tenant file access: tenant B cannot delete tenant A\'s document', async () => {
    const { tenantA, tenantB, tokenA, tokenB } = await setUpTwoTenants();

    const uploadRes = await request(app.getHttpServer())
      .post('/documents/upload-url')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'marksheet.pdf', mimeType: 'application/pdf', category: 'marksheets' })
      .expect(201);
    const documentId = uploadRes.body.document.id as string;

    await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('X-Tenant-Slug', tenantB.slug)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it("cross-tenant notification target: tenant A cannot enqueue a notification for tenant B's user", async () => {
    const { tenantA, tokenA, tenantBAdminUserId } = await setUpTwoTenants();

    // Give tenant A an active plan that includes `notifications`, so the interesting assertion
    // below is specifically about the recipientUserId tenant check, not the feature gate.
    const start = new Date();
    const end = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        tenantId: tenantA.tenant.id,
        planCode: 'professional',
        billingCycle: 'ANNUAL',
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/notifications')
      .set('X-Tenant-Slug', tenantA.slug)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientUserId: tenantBAdminUserId, channel: 'IN_APP', subject: 'hi', body: 'hi' })
      .expect(404);
  });
});
