import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

function subscriptionPeriod() {
  const start = new Date();
  const end = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
  return { currentPeriodStart: start.toISOString(), currentPeriodEnd: end.toISOString() };
}

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | undefined {
  const entries = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const raw = entries.find((entry) => entry.startsWith(`${name}=`));
  return raw?.split(';')[0];
}

/**
 * Covers the Advanced Security Controls task: MFA/TOTP gated by subscription plan, backup
 * codes, "remember this device", password history, security-event logging, and the
 * platform/tenant security-settings hierarchy — plus cross-tenant isolation for every new table
 * that carries a tenantId (mirroring the rigor established in tenant-isolation.e2e-spec.ts /
 * cross-tenant-crud.e2e-spec.ts for earlier phases).
 */
describe('Advanced security controls (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function subscribeToProfessional(tenantId: string) {
    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ tenantId, planCode: 'professional', billingCycle: 'ANNUAL', ...subscriptionPeriod() })
      .expect(201);
  }

  describe('MFA availability is gated by subscription plan', () => {
    it('refuses to enroll a user on a tenant with no active subscription', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('allows enrollment once the tenant is on a plan that includes MFA', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const res = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.secret).toEqual(expect.any(String));
      expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    });
  });

  describe('enroll -> confirm -> login requires a second factor', () => {
    it('issues an MFA challenge on login once enrollment is confirmed, and verify completes it', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const secret = enrollRes.body.secret as string;

      const confirmRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(secret) })
        .expect(201);
      expect(confirmRes.body.backupCodes).toHaveLength(10);

      const statusRes = await request(app.getHttpServer())
        .get('/auth/mfa/status')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(statusRes.body.enabled).toBe(true);
      expect(statusRes.body.backupCodesRemaining).toBe(10);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      expect(loginRes.body.mfaRequired).toBe(true);
      expect(loginRes.body.challengeToken).toEqual(expect.any(String));
      expect(loginRes.body.accessToken).toBeUndefined();

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ challengeToken: loginRes.body.challengeToken, code: authenticator.generate(secret) })
        .expect(200);
      expect(verifyRes.body.accessToken).toEqual(expect.any(String));
      expect(verifyRes.body.user.email).toBe(tenant.adminEmail);
    });

    it('rejects an invalid code and eventually invalidates the challenge after repeated failures', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(enrollRes.body.secret) })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      const { challengeToken } = loginRes.body;

      // The 5th failed attempt itself invalidates the challenge (MAX_CHALLENGE_ATTEMPTS = 5) —
      // its own response is what carries the "log in again" message, not a subsequent call.
      let lastFailureRes: request.Response | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        lastFailureRes = await request(app.getHttpServer())
          .post('/auth/mfa/verify')
          .set('X-Tenant-Slug', tenant.slug)
          .send({ challengeToken, code: '000000' })
          .expect(401);
      }
      expect(JSON.stringify(lastFailureRes?.body)).toMatch(/log in again/i);

      // The challenge is now dead — even the correct code fails, with no attempts left to burn.
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ challengeToken, code: authenticator.generate(enrollRes.body.secret) })
        .expect(401);
    });
  });

  describe('backup codes', () => {
    it('accepts a valid backup code once and rejects it on reuse', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const confirmRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(enrollRes.body.secret) })
        .expect(201);
      const backupCode = confirmRes.body.backupCodes[0] as string;

      const firstLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ challengeToken: firstLogin.body.challengeToken, code: backupCode })
        .expect(200);

      const secondLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ challengeToken: secondLogin.body.challengeToken, code: backupCode })
        .expect(401);
    });
  });

  describe('trusted device ("remember this device")', () => {
    it('skips the MFA challenge on a subsequent login that presents the trusted-device cookie', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(enrollRes.body.secret) })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      const verifyRes = await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenant.slug)
        .send({
          challengeToken: loginRes.body.challengeToken,
          code: authenticator.generate(enrollRes.body.secret),
          rememberDevice: true,
        })
        .expect(200);

      const trustedDeviceCookie = extractCookie(verifyRes.headers['set-cookie'], 'trusted_device');
      expect(trustedDeviceCookie).toBeDefined();

      const nextLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Cookie', trustedDeviceCookie as string)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);
      expect(nextLogin.body.mfaRequired).toBeFalsy();
      expect(nextLogin.body.accessToken).toEqual(expect.any(String));

      const devicesRes = await request(app.getHttpServer())
        .get('/auth/trusted-devices')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${nextLogin.body.accessToken}`)
        .expect(200);
      expect(devicesRes.body.length).toBe(1);
    });

    it("does not honor tenant A's trusted-device cookie for tenant B's user, even the same email", async () => {
      const tenantA = await provisionTenant(app, platformToken);
      const tenantB = await provisionTenant(app, platformToken);
      await Promise.all([subscribeToProfessional(tenantA.tenant.id), subscribeToProfessional(tenantB.tenant.id)]);

      const adminTokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);
      const enrollA = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ code: authenticator.generate(enrollA.body.secret) })
        .expect(201);
      const loginA = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenantA.slug)
        .send({ email: tenantA.adminEmail, password: tenantA.adminPassword })
        .expect(200);
      const verifyA = await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenantA.slug)
        .send({
          challengeToken: loginA.body.challengeToken,
          code: authenticator.generate(enrollA.body.secret),
          rememberDevice: true,
        })
        .expect(200);
      const trustedDeviceCookieA = extractCookie(verifyA.headers['set-cookie'], 'trusted_device') as string;

      const adminTokenB = await loginAsTenantUser(app, tenantB.slug, tenantB.adminEmail, tenantB.adminPassword);
      const enrollB = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenantB.slug)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenantB.slug)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .send({ code: authenticator.generate(enrollB.body.secret) })
        .expect(201);

      // Tenant A's trusted-device cookie must NOT let tenant B's admin skip MFA.
      const crossTenantLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenantB.slug)
        .set('Cookie', trustedDeviceCookieA)
        .send({ email: tenantB.adminEmail, password: tenantB.adminPassword })
        .expect(200);
      expect(crossTenantLogin.body.mfaRequired).toBe(true);
    });
  });

  describe('MFA challenge is bound to the tenant it was issued for', () => {
    it("rejects verifying tenant A's challenge token while resolved against tenant B", async () => {
      const tenantA = await provisionTenant(app, platformToken);
      const tenantB = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenantA.tenant.id);

      const adminTokenA = await loginAsTenantUser(app, tenantA.slug, tenantA.adminEmail, tenantA.adminPassword);
      const enrollA = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenantA.slug)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ code: authenticator.generate(enrollA.body.secret) })
        .expect(201);
      const loginA = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenantA.slug)
        .send({ email: tenantA.adminEmail, password: tenantA.adminPassword })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('X-Tenant-Slug', tenantB.slug)
        .send({ challengeToken: loginA.body.challengeToken, code: authenticator.generate(enrollA.body.secret) })
        .expect(401);
    });
  });

  describe('password history', () => {
    it('blocks changing to the current password and to a recently-replaced one', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ currentPassword: tenant.adminPassword, newPassword: tenant.adminPassword })
        .expect(400);

      const secondPassword = 'SecondPassw0rd!';
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ currentPassword: tenant.adminPassword, newPassword: secondPassword })
        .expect(204);

      const tokenAfterChange = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, secondPassword);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${tokenAfterChange}`)
        .send({ currentPassword: secondPassword, newPassword: tenant.adminPassword })
        .expect(400);
    });

    it('keeps the current session alive but revokes other sessions on a successful change', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword); // "device one"
      const sessionTwoToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${sessionTwoToken}`)
        .send({ currentPassword: tenant.adminPassword, newPassword: 'BrandNewPassw0rd2!' })
        .expect(204);

      // The session that made the change is still valid...
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${sessionTwoToken}`)
        .expect(200);

      // ...but sessionOne only has access via its already-issued access token, which is still
      // technically valid until it expires — the concrete, checkable effect of "other sessions
      // revoked" is that its refresh-backed session is gone from the list.
      const sessions = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${sessionTwoToken}`)
        .expect(200);
      expect(sessions.body.length).toBe(1);
    });
  });

  describe('security events', () => {
    it("logs to the caller's own security-event feed on MFA enable/disable", async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(enrollRes.body.secret) })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/mfa/disable')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: tenant.adminPassword })
        .expect(204);

      const eventsRes = await request(app.getHttpServer())
        .get('/auth/my-security-events')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const eventTypes = (eventsRes.body as Array<{ eventType: string }>).map((e) => e.eventType);
      expect(eventTypes).toContain('MFA_ENABLED');
      expect(eventTypes).toContain('MFA_DISABLED');
    });

    it('cannot disable MFA once the tenant marks it required', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const enrollRes = await request(app.getHttpServer())
        .post('/auth/mfa/enroll')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/mfa/enroll/confirm')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: authenticator.generate(enrollRes.body.secret) })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/tenant/security-settings')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mfaRequired: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/mfa/disable')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: tenant.adminPassword })
        .expect(400);
    });
  });

  describe('security settings hierarchy', () => {
    it('rejects requiring MFA on a tenant whose plan does not include it', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .patch('/tenant/security-settings')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mfaRequired: true })
        .expect(400);
    });

    it('lets a platform admin read and update the global platform security defaults', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/platform/security-settings')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      expect(getRes.body.defaultMaxFailedLoginAttempts).toBe(5);

      const patchRes = await request(app.getHttpServer())
        .patch('/platform/security-settings')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ defaultMaxFailedLoginAttempts: 7 })
        .expect(200);
      expect(patchRes.body.defaultMaxFailedLoginAttempts).toBe(7);

      // Restore, so this test doesn't leak state into whichever test runs next against the same
      // platform-wide singleton row.
      await request(app.getHttpServer())
        .patch('/platform/security-settings')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ defaultMaxFailedLoginAttempts: 5 })
        .expect(200);
    });

    it("a tenant's configured lockout threshold overrides the platform default", async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .patch('/tenant/security-settings')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxFailedLoginAttempts: 3 })
        .expect(200);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .set('X-Tenant-Slug', tenant.slug)
          .send({ email: tenant.adminEmail, password: 'WrongPassword1!' })
          .expect(401);
      }

      // Correct password on the (now-locked, after only 3 attempts) 4th try still fails.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(401);
      expect(JSON.stringify(res.body)).toMatch(/locked/i);
    });
  });

  describe("suspicious login blocking", () => {
    it('blocks a login from a never-seen-before device/IP when the tenant opts into blocking, for a user without MFA', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .patch('/tenant/security-settings')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blockSuspiciousLogins: true })
        .expect(200);

      // The admin's only successful LoginEvent so far was via loginAsTenantUser's default
      // supertest user-agent; querying with a distinctly different one has no matching prior
      // SUCCESS row, so it is flagged as a new device and — with no MFA enrolled — blocked.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .set('User-Agent', 'NeverSeenBeforeClient/1.0')
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(403);
      expect(JSON.stringify(res.body)).toMatch(/unusual/i);
    });
  });

  describe('login notifications on a new device', () => {
    it('queues an in-app notification the first time a user logs in from a new user-agent', async () => {
      const tenant = await provisionTenant(app, platformToken);
      // notifications.controller's list endpoint is itself gated by FEATURE_KEYS.NOTIFICATIONS —
      // unrelated to whether a security notification gets WRITTEN (that's unconditional), but
      // required here to read it back.
      await subscribeToProfessional(tenant.tenant.id);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .set('User-Agent', 'SomeOtherBrowser/2.0')
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(200);

      const notifications = await request(app.getHttpServer())
        .get('/notifications')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        (notifications.body as Array<{ subject: string }>).some((n) => /new sign-in/i.test(n.subject)),
      ).toBe(true);
    });
  });
});
