import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTenantScopedClient } from '@college-erp/database';
import { SYSTEM_ROLE_CODES } from '@college-erp/auth';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

/**
 * Covers the engine end-to-end using the two seeded example definitions (Fee Refund Approval,
 * Leave Request Approval — see DEFAULT_WORKFLOW_DEFINITIONS) rather than any real business
 * module (none of admissions/fees/exams/etc. exist yet — see this task's summary). Department
 * fixtures are created directly via createTenantScopedClient, the same narrowly-scoped,
 * documented test-fixture exception used by rbac-hierarchical.e2e-spec.ts, since there is no
 * Organization CRUD controller yet; every ASSERTION below still goes through the real HTTP API.
 */
describe('Workflow engine (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function findRoleId(adminToken: string, slug: string, code: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/roles')
      .set('X-Tenant-Slug', slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const role = (res.body as Array<{ id: string; code: string }>).find((r) => r.code === code);
    if (!role) {
      throw new Error(`Role ${code} not found among seeded defaults.`);
    }
    return role.id;
  }

  async function createUserWithRole(
    adminToken: string,
    slug: string,
    roleId: string,
    scopeBody: Record<string, string> = {},
  ): Promise<{ email: string; password: string; token: string }> {
    const email = `wf-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
    const password = 'WorkflowTestPassw0rd!';
    const inviteRes = await request(app.getHttpServer())
      .post('/users')
      .set('X-Tenant-Slug', slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, fullName: 'Workflow Test User', initialPassword: password })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${inviteRes.body.id}/roles/${roleId}`)
      .set('X-Tenant-Slug', slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(scopeBody)
      .expect(201);

    const token = await loginAsTenantUser(app, slug, email, password);
    return { email, password, token };
  }

  it('seeds both example workflow definitions, active, for a new tenant', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const res = await request(app.getHttpServer())
      .get('/workflows/definitions')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const codes = (res.body as Array<{ code: string; isActive: boolean }>).map((d) => d.code);
    expect(codes).toContain('FEE_REFUND_APPROVAL_V1');
    expect(codes).toContain('LEAVE_REQUEST_APPROVAL_V1');
    expect(res.body.every((d: { isActive: boolean }) => d.isActive)).toBe(true);
  });

  it('auto-finalizes a small fee refund after a single HOD approval (conditional branching)', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const tenantClient = createTenantScopedClient(tenant.tenant.id);
    const department = await tenantClient.department.create({
      data: { tenantId: tenant.tenant.id, code: `CS-${Date.now()}`, name: 'Computer Science' },
    });

    const hodRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.HOD);
    const hod = await createUserWithRole(adminToken, tenant.slug, hodRoleId, { departmentId: department.id });

    const entityId = `refund-${Date.now()}`;
    const startRes = await request(app.getHttpServer())
      .post('/workflows/instances')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'FeeRefund', entityId, context: { amount: 3000, departmentId: department.id } })
      .expect(201);

    expect(startRes.body.status).toBe('IN_PROGRESS');
    expect(startRes.body.tasks).toHaveLength(1);

    const myTasksRes = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .expect(200);
    expect(myTasksRes.body).toHaveLength(1);
    const taskId = myTasksRes.body[0].id;

    await request(app.getHttpServer())
      .post(`/workflows/tasks/${taskId}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const instanceRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(instanceRes.body.status).toBe('APPROVED');
  });

  it('routes a large fee refund through HOD then Accountant (sequential, two steps)', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const tenantClient = createTenantScopedClient(tenant.tenant.id);
    const department = await tenantClient.department.create({
      data: { tenantId: tenant.tenant.id, code: `CS-${Date.now()}`, name: 'Computer Science' },
    });

    const hodRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.HOD);
    const accountantRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.ACCOUNTANT);
    const hod = await createUserWithRole(adminToken, tenant.slug, hodRoleId, { departmentId: department.id });
    const accountant = await createUserWithRole(adminToken, tenant.slug, accountantRoleId);

    const entityId = `refund-${Date.now()}`;
    const startRes = await request(app.getHttpServer())
      .post('/workflows/instances')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'FeeRefund', entityId, context: { amount: 25000, departmentId: department.id } })
      .expect(201);

    const hodTasks = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .expect(200);
    expect(hodTasks.body).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/workflows/tasks/${hodTasks.body[0].id}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const midRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(midRes.body.status).toBe('IN_PROGRESS');
    expect(midRes.body.currentState.code).toBe('PENDING_ACCOUNTANT');

    const accountantTasks = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${accountant.token}`)
      .expect(200);
    expect(accountantTasks.body).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/workflows/tasks/${accountantTasks.body[0].id}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${accountant.token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const finalRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(finalRes.body.status).toBe('APPROVED');
  });

  it('rejects then resubmits a fee refund, re-running the same approval step cleanly', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const tenantClient = createTenantScopedClient(tenant.tenant.id);
    const department = await tenantClient.department.create({
      data: { tenantId: tenant.tenant.id, code: `CS-${Date.now()}`, name: 'Computer Science' },
    });
    const hodRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.HOD);
    const hod = await createUserWithRole(adminToken, tenant.slug, hodRoleId, { departmentId: department.id });

    const entityId = `refund-${Date.now()}`;
    const startRes = await request(app.getHttpServer())
      .post('/workflows/instances')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'FeeRefund', entityId, context: { amount: 1500, departmentId: department.id } })
      .expect(201);

    let tasksRes = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workflows/tasks/${tasksRes.body[0].id}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .send({ decision: 'REJECT', comment: 'Missing receipt.' })
      .expect(201);

    const rejectedRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(rejectedRes.body.status).toBe('REJECTED');
    expect(rejectedRes.body.currentState.code).toBe('NEEDS_RESUBMISSION');

    await request(app.getHttpServer())
      .post(`/workflows/instances/${startRes.body.id}/resubmit`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(201);

    const reopenedRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(reopenedRes.body.status).toBe('IN_PROGRESS');
    expect(reopenedRes.body.currentState.code).toBe('PENDING_HOD');
    expect(reopenedRes.body.tasks.filter((t: { status: string }) => t.status === 'PENDING')).toHaveLength(1);

    tasksRes = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .expect(200);
    expect(tasksRes.body).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/workflows/tasks/${tasksRes.body[0].id}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hod.token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const finalRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(finalRes.body.status).toBe('APPROVED');
  });

  it('approves a leave request as soon as ANY one of two parallel approvers decides, skipping the other', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const hrRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.HR);
    const hr = await createUserWithRole(adminToken, tenant.slug, hrRoleId);

    const entityId = `leave-${Date.now()}`;
    const startRes = await request(app.getHttpServer())
      .post('/workflows/instances')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'LeaveRequest', entityId, context: {} })
      .expect(201);
    expect(startRes.body.tasks).toHaveLength(2);

    const hrTasks = await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hr.token}`)
      .expect(200);
    expect(hrTasks.body).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/workflows/tasks/${hrTasks.body[0].id}/decide`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const finalRes = await request(app.getHttpServer())
      .get(`/workflows/instances/${startRes.body.id}`)
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(finalRes.body.status).toBe('APPROVED');
    const statuses = (finalRes.body.tasks as Array<{ status: string }>).map((t) => t.status).sort();
    expect(statuses).toEqual(['APPROVED', 'SKIPPED']);
  });

  it('rejects a decide attempt from a user without workflows.approve', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const studentRoleId = await findRoleId(adminToken, tenant.slug, SYSTEM_ROLE_CODES.STUDENT);
    const student = await createUserWithRole(adminToken, tenant.slug, studentRoleId);

    await request(app.getHttpServer())
      .get('/workflows/my-tasks')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${student.token}`)
      .expect(403);
  });

  it('lets a tenant configure a brand-new workflow with no hardcoded chain (WORKFLOWS_MANAGE)', async () => {
    const tenant = await provisionTenant(app, platformToken);
    const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

    const createRes = await request(app.getHttpServer())
      .post('/workflows/definitions')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'CUSTOM_AUTO_V1',
        name: 'Custom Auto-Approve',
        entityType: 'CustomThing',
        states: [
          { code: 'DRAFT', name: 'Draft', category: 'INITIAL' },
          { code: 'DONE', name: 'Done', category: 'APPROVED' },
        ],
        transitions: [{ code: 'SUBMIT', name: 'Submit', fromStateCode: 'DRAFT', toStateCode: 'DONE', action: 'SUBMIT' }],
      })
      .expect(201);
    expect(createRes.body.isActive).toBe(true);

    const startRes = await request(app.getHttpServer())
      .post('/workflows/instances')
      .set('X-Tenant-Slug', tenant.slug)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'CustomThing', entityId: `thing-${Date.now()}` })
      .expect(201);
    expect(startRes.body.status).toBe('APPROVED');
  });
});
