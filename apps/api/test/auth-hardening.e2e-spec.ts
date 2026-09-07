import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app.util';
import { loginAsPlatformAdmin, loginAsTenantUser, provisionTenant } from './utils/platform-admin.util';

/**
 * No email provider exists yet (Phase 8+ Integrations) — PasswordResetService/
 * EmailVerificationService log the token instead of emailing it (see their doc comments).
 * Spying on Logger.prototype.log (a real prototype method, not per-instance-bound — verified
 * against @nestjs/common's implementation) lets these e2e tests capture that token and drive
 * the full forgot/reset and invite/verify round trips exactly like a real client would after
 * clicking the link in an email.
 */
function captureLoggedToken(pattern: RegExp) {
  let captured: string | undefined;
  const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(function mockLog(message?: unknown) {
    const match = String(message).match(pattern);
    if (match) {
      captured = match[1];
    }
    return undefined as unknown as void;
  });
  return { spy, getToken: () => captured };
}

describe('Auth hardening (e2e)', () => {
  let app: INestApplication;
  let platformToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    platformToken = await loginAsPlatformAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('account lockout (brute-force protection)', () => {
    it('locks the account after repeated failed attempts and rejects even the correct password while locked', async () => {
      const tenant = await provisionTenant(app, platformToken);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .set('X-Tenant-Slug', tenant.slug)
          .send({ email: tenant.adminEmail, password: 'TotallyWrongPassword1!' })
          .expect(401);
      }

      // 6th attempt, even with the CORRECT password, must still fail while locked.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(401);

      expect(JSON.stringify(res.body)).toMatch(/locked/i);
    });
  });

  describe('forgot / reset password', () => {
    it('completes the round trip, rejects reuse, and revokes existing sessions', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const originalToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${originalToken}`)
        .expect(200);

      // Unknown email must resolve exactly like a known one — no enumeration signal.
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: 'does-not-exist@example.com' })
        .expect(204);

      const { getToken } = captureLoggedToken(/Reset token \(not delivered[^:]*: ([0-9a-f]+)/);

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail })
        .expect(204);

      const rawToken = getToken();
      expect(rawToken).toBeDefined();

      const newPassword = 'BrandNewPassw0rd!';
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ token: rawToken, newPassword })
        .expect(204);

      // Reusing the same (now-consumed) token must fail.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ token: rawToken, newPassword: 'AnotherPassw0rd!' })
        .expect(401);

      // Old password no longer works.
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: tenant.adminPassword })
        .expect(401);

      // New password does.
      const newLoginToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, newPassword);

      // The session that existed BEFORE the reset must be dead — its refresh cookie can't be
      // used to mint a new access token anymore (we don't have that raw cookie here, so we
      // assert the equivalent: the old session is gone from /auth/sessions).
      const sessions = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${newLoginToken}`)
        .expect(200);
      expect(sessions.body.length).toBe(1); // only the post-reset login session remains active
    });

    it('rejects a reset token issued for a different tenant', async () => {
      const tenantA = await provisionTenant(app, platformToken);
      const tenantB = await provisionTenant(app, platformToken);

      const { getToken } = captureLoggedToken(/Reset token \(not delivered[^:]*: ([0-9a-f]+)/);
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('X-Tenant-Slug', tenantA.slug)
        .send({ email: tenantA.adminEmail })
        .expect(204);
      const rawToken = getToken();

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Tenant-Slug', tenantB.slug)
        .send({ token: rawToken, newPassword: 'ShouldNeverApply1!' })
        .expect(401);
    });
  });

  describe('email verification', () => {
    it('verifies an invited user via the logged token and rejects reuse', async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const { getToken } = captureLoggedToken(/Verification token \(not delivered[^:]*: ([0-9a-f]+)/);

      const newUserEmail = `verify-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/users')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: newUserEmail, fullName: 'Verify Me', initialPassword: 'InvitedUserPassw0rd!' })
        .expect(201);

      const rawToken = getToken();
      expect(rawToken).toBeDefined();

      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ token: rawToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ token: rawToken })
        .expect(401);
    });
  });

  describe('session management', () => {
    it('lists active sessions, flags the current one, and lets a user revoke their own other session', async () => {
      const tenant = await provisionTenant(app, platformToken);
      await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword); // "device one"
      const deviceTwoToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const listRes = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${deviceTwoToken}`)
        .expect(200);

      expect(listRes.body.length).toBeGreaterThanOrEqual(2);
      const current = listRes.body.find((s: { current: boolean }) => s.current);
      const other = listRes.body.find((s: { current: boolean }) => !s.current);
      expect(current).toBeDefined();
      expect(other).toBeDefined();

      await request(app.getHttpServer())
        .delete(`/auth/sessions/${other.id}`)
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${deviceTwoToken}`)
        .expect(204);

      const listAfter = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${deviceTwoToken}`)
        .expect(200);
      expect(listAfter.body.find((s: { id: string }) => s.id === other.id)).toBeUndefined();
    });

    it("cannot revoke another tenant user's session", async () => {
      const tenant = await provisionTenant(app, platformToken);
      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const newUserEmail = `session-owner-${Date.now()}@example.com`;
      const newUserPassword = 'OtherUserPassw0rd!';
      await request(app.getHttpServer())
        .post('/users')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: newUserEmail, fullName: 'Other User', initialPassword: newUserPassword })
        .expect(201);
      const otherUserToken = await loginAsTenantUser(app, tenant.slug, newUserEmail, newUserPassword);

      const otherUserSessions = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .expect(200);
      const otherUserSessionId = otherUserSessions.body[0].id;

      await request(app.getHttpServer())
        .delete(`/auth/sessions/${otherUserSessionId}`)
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it("returns the caller's own login history, including failed attempts", async () => {
      const tenant = await provisionTenant(app, platformToken);

      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Tenant-Slug', tenant.slug)
        .send({ email: tenant.adminEmail, password: 'WrongPassword1!' })
        .expect(401);

      const adminToken = await loginAsTenantUser(app, tenant.slug, tenant.adminEmail, tenant.adminPassword);

      const historyRes = await request(app.getHttpServer())
        .get('/auth/login-history')
        .set('X-Tenant-Slug', tenant.slug)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const results = (historyRes.body as Array<{ result: string }>).map((entry) => entry.result);
      expect(results).toContain('SUCCESS');
      expect(results).toContain('FAILED_PASSWORD');
    });
  });
});
