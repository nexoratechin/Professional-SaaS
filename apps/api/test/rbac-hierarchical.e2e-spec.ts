import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenantScopedClient } from '@college-erp/database';
import { SYSTEM_ROLE_CODES } from '@college-erp/auth';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

/**
 * Organization (Campus/Department/Program) has no CRUD controller yet (schema-only pass — see
 * packages/database's schema header), so there is no HTTP way to create the department fixture
 * these tests need to prove DEPARTMENT-scoped role assignment actually works end to end.
 * Reaching into Prisma directly here (via the same createTenantScopedClient every real service
 * uses — never a raw/unscoped client) is a deliberate, narrow exception for test fixture setup
 * only; every ASSERTION in this file still goes through the real HTTP API.
 */
describe('Hierarchical RBAC (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions all 14 system roles (College Admin + 13 defaults) for a new tenant', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const codes = (rolesRes.body as Array<{ code: string; isSystem: boolean }>).map((role) => role.code);
    const expectedCodes = Object.values(SYSTEM_ROLE_CODES);
    for (const code of expectedCodes) {
      expect(codes).toContain(code);
    }
    expect(rolesRes.body.every((role: { isSystem: boolean }) => role.isSystem)).toBe(true);
  });

  it('MANAGE on a module implies its VIEW/CREATE/UPDATE/DELETE permissions', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'STUDENT_RECORDS_MANAGER', name: 'Student Records Manager' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/roles/${roleRes.body.id}/permissions`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['students.manage'] })
      .expect(200);

    const newUserEmail = `manager-${Date.now()}@example.com`;
    const newUserPassword = 'ManagerPassw0rd!';
    const inviteRes = await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: newUserEmail, fullName: 'Records Manager', initialPassword: newUserPassword })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${inviteRes.body.id}/roles/${roleRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const managerToken = await loginAsTenantUser(app, tenant.slug, newUserEmail, newUserPassword);
    const permsRes = await request(app.getHttpServer())
      .get('/auth/permissions')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    const permissions: string[] = permsRes.body.permissions;
    expect(permissions).toContain('students.manage');
    expect(permissions).toContain('students.view');
    expect(permissions).toContain('students.create');
    expect(permissions).toContain('students.update');
    expect(permissions).toContain('students.delete');
    // students.export is a real, separate permission NOT implied by manage (only VIEW/CREATE/
    // UPDATE/DELETE are) — proves the expansion is exactly the four CRUD actions, not "everything
    // in the module".
    expect(permissions).not.toContain('students.export');
  });

  it("resolves a role assignment's org-unit scope through the effective-permissions-with-scope endpoint", async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    // Fixture only — see file header. Every assertion below goes through the real HTTP API.
    const tenantClient = createTenantScopedClient(tenant.tenant.id);
    const department = await tenantClient.department.create({
      data: { tenantId: tenant.tenant.id, code: `CS-${Date.now()}`, name: 'Computer Science' },
    });

    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const hodRole = (rolesRes.body as Array<{ id: string; code: string }>).find(
      (role) => role.code === SYSTEM_ROLE_CODES.HOD,
    )!;

    const newUserEmail = `hod-${Date.now()}@example.com`;
    const newUserPassword = 'HodPassword123!';
    const inviteRes = await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: newUserEmail, fullName: 'Dr. Smith', initialPassword: newUserPassword })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${inviteRes.body.id}/roles/${hodRole.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentId: department.id })
      .expect(201);

    const hodToken = await loginAsTenantUser(app, tenant.slug, newUserEmail, newUserPassword);
    const scopedRes = await request(app.getHttpServer())
      .get('/auth/my-scoped-permissions')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hodToken}`)
      .expect(200);

    const academicsViewGrants = scopedRes.body['academics.view'];
    expect(academicsViewGrants).toEqual(
      expect.arrayContaining([expect.objectContaining({ scopeType: 'DEPARTMENT', departmentId: department.id })]),
    );
  });

  it('rejects assigning a role scoped to a department that does not exist in this tenant', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const facultyRole = (rolesRes.body as Array<{ id: string; code: string }>).find(
      (role) => role.code === SYSTEM_ROLE_CODES.FACULTY,
    )!;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/users/${meRes.body.id}/roles/${facultyRole.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });
});
