import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform-admin@college-erp.local';
export const PLATFORM_ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe123!';

export async function loginAsPlatformAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/platform/auth/login')
    .send({ email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

export interface ProvisionedTenant {
  tenant: { id: string; slug: string; name: string };
  slug: string;
  adminEmail: string;
  adminPassword: string;
}

export async function provisionTenant(app: INestApplication, platformToken: string): Promise<ProvisionedTenant> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const slug = `test-tenant-${suffix}`;
  const adminEmail = `admin+${suffix}@example.com`;
  const adminPassword = 'TestPassword123!';

  const res = await request(app.getHttpServer())
    .post('/tenants')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      slug,
      name: `Test Tenant ${suffix}`,
      billingEmail: `billing+${suffix}@example.com`,
      adminEmail,
      adminFullName: 'Test Admin',
      adminPassword,
    })
    .expect(201);

  return { tenant: res.body, slug, adminEmail, adminPassword };
}

export async function loginAsTenantUser(
  app: INestApplication,
  slug: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .set('X-Tenant-Slug', slug)
    .send({ email, password })
    .expect(200);
  return res.body.accessToken;
}
