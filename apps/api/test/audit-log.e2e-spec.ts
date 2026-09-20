import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

describe('Centralized audit log (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes a centralized, module-tagged entry for a successful login and echoes X-Request-Id', async () => {
    const tenant = await provisionTenant(app, platformToken);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Tenant-Slug', tenant.slug)
      .send({ email: tenant.adminEmail, password: tenant.adminPassword })
      .expect(200);
    expect(loginRes.headers['x-request-id']).toBeTruthy();

    const adminToken = loginRes.body.accessToken as string;
    const auditRes = await request(app.getHttpServer())
      .get('/tenant/audit-logs')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ module: 'auth', action: 'LOGIN_SUCCESS' })
      .expect(200);

    expect(Number(auditRes.headers['x-total-count'])).toBeGreaterThanOrEqual(1);
    const entries = auditRes.body as Array<{ module: string; action: string; actorEmail: string | null }>;
    expect(entries.some((entry) => entry.module === 'auth' && entry.actorEmail === tenant.adminEmail)).toBe(true);
  });

  it('writes a centralized entry for logout', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const auditRes = await request(app.getHttpServer())
      .get('/tenant/audit-logs')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ action: 'LOGOUT' })
      .expect(200);

    const entries = auditRes.body as Array<{ action: string }>;
    expect(entries.some((entry) => entry.action === 'LOGOUT')).toBe(true);
  });

  it('tags role/permission changes with module "rbac" and supports actorEmail search', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'AUDIT_TEST_ROLE', name: 'Audit Test Role' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/roles/${roleRes.body.id}/permissions`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['users.read'] })
      .expect(200);

    const auditRes = await request(app.getHttpServer())
      .get('/tenant/audit-logs')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ module: 'rbac', actorEmail: tenant.adminEmail })
      .expect(200);

    const entries = auditRes.body as Array<{ module: string; action: string; actorEmail: string | null }>;
    expect(entries.some((entry) => entry.action === 'ROLE_CREATED')).toBe(true);
    expect(entries.some((entry) => entry.action === 'ROLE_PERMISSIONS_UPDATED')).toBe(true);
    expect(entries.every((entry) => entry.module === 'rbac')).toBe(true);
  });

  it('rejects a tenant user without audit.read from searching the audit log', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const studentRole = (rolesRes.body as Array<{ id: string; code: string }>).find(
      (role) => role.code === 'STUDENT',
    )!;

    const newUserEmail = `student-${Date.now()}@example.com`;
    const newUserPassword = 'StudentPassw0rd!';
    const inviteRes = await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: newUserEmail, fullName: 'Test Student', initialPassword: newUserPassword })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${inviteRes.body.id}/roles/${studentRole.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const studentToken = await loginAsTenantUser(app, tenant.slug, newUserEmail, newUserPassword);
    await request(app.getHttpServer())
      .get('/tenant/audit-logs')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(403);
  });
});
