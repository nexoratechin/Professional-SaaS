import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

describe('RBAC permissions (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks a role-less user and allows one holding the required permission', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const newUserEmail = `viewer+${Date.now()}@example.com`;
    const newUserPassword = 'ViewerPassword123!';
    const inviteRes = await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: newUserEmail, fullName: 'Test Viewer', initialPassword: newUserPassword })
      .expect(201);

    const newUserToken = await loginAsTenantUser(app, tenant.slug, newUserEmail, newUserPassword);

    await request(app.getHttpServer())
      .get('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${newUserToken}`)
      .expect(403);

    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'VIEWER', name: 'Viewer' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/roles/${roleRes.body.id}/permissions`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['users.read'] })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/users/${inviteRes.body.id}/roles/${roleRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${newUserToken}`)
      .expect(200);
  });

  it('protects system roles from permission changes', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const tenantAdminRole = (rolesRes.body as Array<{ code: string; id: string }>).find(
      (role) => role.code === 'TENANT_ADMIN',
    );
    expect(tenantAdminRole).toBeDefined();

    await request(app.getHttpServer())
      .patch(`/roles/${tenantAdminRole!.id}/permissions`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: [] })
      .expect(400);
  });
});
