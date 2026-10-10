import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OnboardingService } from './onboarding.service';

type Mutable<T> = { [K in keyof T]?: T[K] };

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'os_1',
    tenantId: null as string | null,
    tenantSlug: null as string | null,
    tenantName: null as string | null,
    status: 'IN_PROGRESS',
    currentStep: 2,
    completedSteps: ['ACCOUNT'] as unknown,
    accountEmail: 'admin@college.test',
    accountFullName: 'Ada Admin',
    accountPasswordHash: '$2a$12$storedhash',
    adminUserId: null as string | null,
    adminEmail: null as string | null,
    adminFullName: null as string | null,
    planCode: null as string | null,
    data: {} as Record<string, unknown>,
    tokenHash: 'stored-hash',
    ipAddress: null,
    userAgent: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    completedAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(overrides: Mutable<Record<string, unknown>> = {}) {
  const platformPrisma = {
    client: {
      onboardingSession: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(sessionRow(data))),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(sessionRow(data))),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      plan: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      featureFlag: { findMany: jest.fn() },
      tenantFeatureFlag: { upsert: jest.fn() },
    },
  };
  const tenantContext = { setTenant: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const provisioning = { provisionDefaultAdmin: jest.fn() };
  const tenantConfiguration = { get: jest.fn().mockResolvedValue({}), update: jest.fn() };
  const branding = { createUploadUrl: jest.fn(), confirmAsset: jest.fn() };
  const organization = { create: jest.fn(), importCsv: jest.fn() };
  const entitlements = { recompute: jest.fn().mockResolvedValue(undefined) };
  const tenantFeatures = { invalidate: jest.fn(), getEffectiveFeatures: jest.fn().mockResolvedValue({}) };
  const notifications = { sendSystem: jest.fn().mockResolvedValue(undefined) };
  const tenantLookup = { invalidate: jest.fn().mockResolvedValue(undefined) };

  const service = new OnboardingService(
    platformPrisma as never,
    tenantContext as never,
    auditService as never,
    provisioning as never,
    tenantConfiguration as never,
    branding as never,
    organization as never,
    entitlements as never,
    tenantFeatures as never,
    notifications as never,
    tenantLookup as never,
  );

  const mocks = {
    platformPrisma,
    tenantContext,
    auditService,
    provisioning,
    tenantConfiguration,
    branding,
    organization,
    entitlements,
    tenantFeatures,
    notifications,
    tenantLookup,
    ...overrides,
  };
  return { service, mocks };
}

describe('OnboardingService', () => {
  describe('createAccount', () => {
    it('mints an opaque token, stores only its hash, and starts the session at step 2', async () => {
      const { service, mocks } = makeService();
      mocks.platformPrisma.client.onboardingSession.findFirst.mockResolvedValue(null);

      const result = await service.createAccount(
        { fullName: 'Ada Admin', email: 'Admin@College.Test', password: 'Str0ng!Passw0rd' },
        { ipAddress: '127.0.0.1', userAgent: 'jest' },
      );

      expect(result.onboardingToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.session.completedSteps).toEqual(['ACCOUNT']);
      expect(result.session.currentStep).toBe(2);

      const createArg = mocks.platformPrisma.client.onboardingSession.create.mock.calls[0]![0] as {
        data: { tokenHash: string; accountEmail: string; accountPasswordHash: string };
      };
      // Only the SHA-256 hash of the token is persisted — never the raw token.
      expect(createArg.data.tokenHash).toBe(createHash('sha256').update(result.onboardingToken).digest('hex'));
      expect(createArg.data.tokenHash).not.toBe(result.onboardingToken);
      // Email is normalised and the password is stored hashed, never in plaintext.
      expect(createArg.data.accountEmail).toBe('admin@college.test');
      expect(createArg.data.accountPasswordHash).not.toBe('Str0ng!Passw0rd');
      expect(mocks.auditService.record).toHaveBeenCalledTimes(1);
    });

    it('refuses a second in-progress session for the same email', async () => {
      const { service, mocks } = makeService();
      mocks.platformPrisma.client.onboardingSession.findFirst.mockResolvedValue(sessionRow());
      await expect(
        service.createAccount({ fullName: 'A', email: 'a@b.test', password: 'Str0ng!Passw0rd' }, {}),
      ).rejects.toThrow();
    });
  });

  describe('getSession', () => {
    it('rejects a missing token', async () => {
      const { service } = makeService();
      await expect(service.getSession(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('expires an elapsed session and refuses to resume it', async () => {
      const { service, mocks } = makeService();
      mocks.platformPrisma.client.onboardingSession.findUnique.mockResolvedValue(
        sessionRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.getSession('deadbeef')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.platformPrisma.client.onboardingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ABANDONED' } }),
      );
    });
  });

  describe('selectPlan', () => {
    it('creates an ACTIVE subscription, recomputes entitlements and advances the session', async () => {
      const { service, mocks } = makeService();
      mocks.platformPrisma.client.onboardingSession.findUnique.mockResolvedValue(
        sessionRow({ tenantId: 't1', tenantSlug: 'acme', tenantName: 'Acme', adminUserId: 'u1' }),
      );
      mocks.platformPrisma.client.plan.findUnique.mockResolvedValue({
        id: 'plan1',
        code: 'starter',
        name: 'Starter',
        description: null,
        priceCents: 100000,
        currency: 'INR',
        billingCycle: 'ANNUAL',
        isActive: true,
        isCustom: false,
        planFeatures: [],
        planModules: [],
      });

      const result = await service.selectPlan('token', { planCode: 'starter' });

      expect(mocks.platformPrisma.client.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: 't1', planId: 'plan1', status: 'ACTIVE' }),
        }),
      );
      expect(mocks.entitlements.recompute).toHaveBeenCalledWith('t1');
      expect(result.completedSteps).toContain('PLAN');
    });
  });

  describe('complete', () => {
    it('provisions roles for the existing admin, activates the tenant and sends a welcome notice', async () => {
      const { service, mocks } = makeService();
      mocks.platformPrisma.client.onboardingSession.findUnique.mockResolvedValue(
        sessionRow({
          tenantId: 't1',
          tenantSlug: 'acme',
          tenantName: 'Acme',
          adminUserId: 'u1',
          adminEmail: 'admin@acme.test',
          adminFullName: 'Ada Admin',
          planCode: 'starter',
        }),
      );
      mocks.provisioning.provisionDefaultAdmin.mockResolvedValue({
        adminUserId: 'u1',
        rolesCreated: 15,
        permissionsGranted: 200,
      });
      mocks.platformPrisma.client.tenant.update.mockResolvedValue({
        id: 't1',
        slug: 'acme',
        name: 'Acme',
        status: 'ACTIVE',
      });

      const result = await service.complete('token');

      expect(mocks.provisioning.provisionDefaultAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', existingUserId: 'u1' }),
      );
      expect(mocks.platformPrisma.client.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' }, data: { status: 'ACTIVE' } }),
      );
      expect(mocks.tenantLookup.invalidate).toHaveBeenCalledWith('acme');
      expect(mocks.notifications.sendSystem).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ recipientUserId: 'u1' }),
      );
      expect(mocks.tenantContext.setTenant).toHaveBeenCalledWith('t1', 'acme');
      expect(result.tenant.status).toBe('ACTIVE');
      expect(result.rolesCreated).toBe(15);
      expect(result.permissionsGranted).toBe(200);
      expect(result.welcomeNotificationSent).toBe(true);
    });
  });
});
