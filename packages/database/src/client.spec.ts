import { isTenantScopedModel } from './client';

describe('tenant-guard model classification (from Prisma DMMF)', () => {
  const tenantScoped = [
    'Subscription',
    'SubscriptionItem',
    'TenantFeatureFlag',
    'UsageEvent',
    'User',
    'Role',
    'RolePermission',
    'UserRole',
    'Session',
    'Campus',
    'Department',
    'Program',
    'AcademicYear',
    'Term',
    'Room',
    'Notification',
    'Document',
    'PasswordResetToken',
    'EmailVerificationToken',
    'MfaBackupCode',
    'TrustedDevice',
    'PasswordHistory',
    'TenantSecuritySettings',
  ];

  const notTenantScoped = [
    'Tenant',
    'Plan',
    'FeatureFlag',
    'PlanFeatureFlag',
    'Permission',
    'PlatformUser',
    'PlatformSession',
    'PlatformAuditLog',
    'LoginEvent',
    'PlatformMfaBackupCode',
    'SecurityEvent',
    'PlatformSecuritySettings',
  ];

  it.each(tenantScoped)('%s is tenant-scoped (guarded by the extension)', (model) => {
    expect(isTenantScopedModel(model)).toBe(true);
  });

  it.each(notTenantScoped)('%s is NOT tenant-scoped (accessed only via PlatformPrismaService)', (model) => {
    expect(isTenantScopedModel(model)).toBe(false);
  });
});
