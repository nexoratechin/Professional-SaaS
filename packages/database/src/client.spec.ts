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
    'Building',
    'Batch',
    'Section',
    'Notification',
    'Document',
    'PasswordResetToken',
    'EmailVerificationToken',
    'MfaBackupCode',
    'TrustedDevice',
    'PasswordHistory',
    'TenantSecuritySettings',
    'TenantConfiguration',
    // Enterprise tenant physical-store metadata — carries a required tenantId, so the guard scopes
    // it too (defence in depth on top of the control-plane access via PlatformPrismaService).
    'TenantDatabase',
    'WorkflowDefinition',
    'WorkflowState',
    'WorkflowTransition',
    'WorkflowTransitionApprover',
    'WorkflowInstance',
    'WorkflowApprovalTask',
    'Invoice',
    'InvoiceLineItem',
    'Entitlement',
    'Course',
    'CoursePrerequisite',
    'Curriculum',
    'CurriculumVersion',
    'CurriculumCourse',
    'CourseOffering',
    'CourseOfferingFaculty',
    'CourseRegistration',
    'AcademicAdvisingRecord',
    'AcademicProgressionRecord',
    'CourseBacklog',
    'AcademicCalendarEvent',
    'Timetable',
    'TimetablePeriod',
    'TimetableEntry',
    'TimetableHoliday',
    'FacultyAvailability',
    'TimetableConflict',
    'TimetableSubstitution',
    'TimetableHistory',
    'AttendanceSession',
    'AttendanceCorrectionRequest',
    'FacultyAttendance',
    'AttendanceDevice',
    'AttendanceDeviceUser',
    'AttendanceDeviceLog',
    'FeeHead',
    'FeeStructure',
    'FeeStructureLine',
    'StudentFeeAssignment',
    'FeeDemand',
    'FeeConcession',
    'FeeRefund',
    'FeeSequence',
    'StudentFeeAllocation',
    // Generic integration framework. Each carries a REQUIRED tenantId, which is what makes the
    // DMMF-derived guard auto-scope it — and therefore what stops one tenant reading another's
    // payment credentials, webhook events, operations or sync ledger. Dropping tenantId here would
    // be a silent cross-tenant data leak, not a type error.
    'Integration',
    'IntegrationWebhookEndpoint',
    'IntegrationWebhookEvent',
    'IntegrationOperation',
    'IntegrationSyncRun',
    'IntegrationSyncRecord',
    'IntegrationFailure',
  ];

  const notTenantScoped = [
    'Tenant',
    'Plan',
    'FeatureFlag',
    'PlanFeatureFlag',
    'PlanModule',
    'Permission',
    'PlatformUser',
    'PlatformSession',
    'PlatformAuditLog',
    'LoginEvent',
    'PlatformMfaBackupCode',
    'SecurityEvent',
    'PlatformSecuritySettings',
    'SupportTicket',
    'SupportTicketComment',
  ];

  it.each(tenantScoped)('%s is tenant-scoped (guarded by the extension)', (model) => {
    expect(isTenantScopedModel(model)).toBe(true);
  });

  it.each(notTenantScoped)('%s is NOT tenant-scoped (accessed only via PlatformPrismaService)', (model) => {
    expect(isTenantScopedModel(model)).toBe(false);
  });
});
