/** Shared response-shape contracts between apps/api and apps/web. Plain data only — no
 * class-validator/NestJS decorators here, so this package stays usable from the frontend. */

export * from './jobs';
export * from './students';

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  timezone: string;
}

export interface CurrentUserDto {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  roles: string[];
}

export interface PermissionsResponseDto {
  permissions: string[];
}

export interface FeatureFlagsResponseDto {
  features: Record<string, boolean>;
}

/** Response of GET /tenant/entitlements/effective — the full entitlement view for the current
 * tenant: granular capability flags (e.g. attendance.qr) plus module-level feature flags. This is
 * what the frontend/navigation reads; it is intentionally available to every authenticated tenant
 * role (no RBAC permission beyond being logged in). */
export interface EffectiveEntitlementsResponseDto {
  entitlements: Record<string, boolean>;
  modules: Record<string, boolean>;
}

export interface LoginRequestDto {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface LoginResponseDto {
  mfaRequired?: false;
  accessToken: string;
  accessTokenExpiresAt: string;
  user: CurrentUserDto;
  /** Tenant enforces MFA but this user hasn't enrolled yet — a soft nag, not a hard block. */
  mfaSetupRequired?: boolean;
}

export interface MfaChallengeResponseDto {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

/** POST /auth/login's response shape — a normal LoginResponseDto, or a challenge the client
 * must resolve via POST /auth/mfa/verify before it has a real access token. */
export type LoginResultDto = LoginResponseDto | MfaChallengeResponseDto;

/** One row from the centralized audit trail — GET /tenant/audit-logs or /platform/audit-logs. */
export interface AuditLogEntryDto {
  id: string;
  scope: 'PLATFORM' | 'TENANT';
  tenantId: string | null;
  actorType: string;
  actorUserId: string | null;
  actorPlatformUserId: string | null;
  actorEmail: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

/** Query filters accepted by both audit-log list endpoints — see AuditService.search(). */
export interface AuditLogQueryDto {
  skip?: number;
  take?: number;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorEmail?: string;
  requestId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ---------------------------------------------------------------------------
// Platform control plane (apps/web's separate /platform administration area)
// ---------------------------------------------------------------------------

export interface PlatformUserDto {
  id: string;
  email: string;
  fullName: string;
  role: 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';
}

export interface PlatformLoginResponseDto {
  mfaRequired?: false;
  accessToken: string;
  platformUser: PlatformUserDto;
  mfaSetupRequired?: boolean;
}

export interface PlatformMfaChallengeResponseDto {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

/** POST /platform/auth/login's response shape — a normal PlatformLoginResponseDto, or an MFA
 * challenge (no UI built for it yet in the platform admin area — see PlatformAuthProvider). */
export type PlatformLoginResultDto = PlatformLoginResponseDto | PlatformMfaChallengeResponseDto;

export interface PlatformTenantDto {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  billingEmail: string;
  timezone: string;
  createdAt: string;
}

export interface TenantUsageDto {
  totalUsers: number;
  activeUsers: number;
  studentCount: number;
  storageUsedBytes: number;
  documentCount: number;
  campusCount: number;
  departmentCount: number;
  recentUsageEvents: Array<{ id: string; eventType: string; quantity: string; occurredAt: string }>;
}

export interface PlatformDashboardSummaryDto {
  totalTenants: number;
  tenantsByStatus: Record<string, number>;
  totalActiveUsers: number;
  studentRoleHolders: number;
  totalStorageUsedBytes: number;
  subscriptionsByStatus: Record<string, number>;
  openSupportTickets: number;
}

export interface SystemHealthDto {
  status: 'ok' | 'degraded';
  database: { ok: boolean; latencyMs?: number; error?: string };
  redis: { ok: boolean; latencyMs?: number; error?: string };
  timestamp: string;
}

export interface StorageUsageByTenantDto {
  tenantId: string;
  tenant: { id: string; slug: string; name: string } | null;
  documentCount: number;
  storageUsedBytes: number;
}

// ---------------------------------------------------------------------------
// SaaS billing (apps/api/src/modules/billing + apps/api/src/modules/saas)
// ---------------------------------------------------------------------------

export interface InvoiceLineItemDto {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface InvoiceDto {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'VOID';
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  pdfStorageKey: string | null;
  lineItems: InvoiceLineItemDto[];
  payments?: PaymentDto[];
}

export interface PaymentDto {
  id: string;
  tenantId: string;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  method: 'CARD' | 'UPI' | 'BANK_TRANSFER' | 'CASH' | 'OFFLINE';
  gatewayReference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface PaymentListDto {
  data: PaymentDto[];
  total: number;
}

export interface BillingConfigDto {
  id: string;
  taxName: string;
  taxRateBps: number;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  gracePeriodDays: number;
  renewalDueDays: number;
  retryIntervalDays: number;
  prorationEnabled: boolean;
}

export interface BillingSummaryDto {
  totalBilledCents: number;
  totalCollectedCents: number;
  totalOutstandingCents: number;
  invoiceCounts: Record<string, number>;
  paymentCounts: Record<string, number>;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  trials: number;
}

export interface PlanChangePreviewDto {
  currentPlan: { id: string; code: string; name: string; priceCents: number | null };
  targetPlan: { id: string; code: string; name: string; priceCents: number | null };
  direction: 'UPGRADE' | 'DOWNGRADE' | 'UNCHANGED';
  prorationEnabled: boolean;
  periodStart: string;
  periodEnd: string;
  remainingCreditCents: number;
  proratedChargeCents: number;
  netAmountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Combined tenant self-service billing overview — GET /tenant/billing. */
export interface TenantBillingOverviewDto {
  subscription: {
    id: string;
    status: string;
    billingCycle: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    plan: { id: string; code: string; name: string; priceCents: number | null; currency: string };
  } | null;
  invoices: InvoiceDto[];
  payments: PaymentDto[];
  config: { taxName: string; taxRateBps: number; gracePeriodDays: number; renewalDueDays: number };
  plans: Array<{ id: string; code: string; name: string; priceCents: number | null }>;
}

// ---------------------------------------------------------------------------
// Tenant configuration engine
// ---------------------------------------------------------------------------

/** Branding section of the tenant configuration document. logoKey/logoUrl both describe the
 * tenant's uploaded logo: logoKey is the storage key (uploaded via the documents/storage
 * infrastructure), logoUrl a convenience direct URL when one was provided. */
export interface TenantConfigBranding {
  collegeName: string | null;
  tagline: string | null;
  logoKey: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

export interface TenantConfigAcademicCalendar {
  startDate: string | null;
  endDate: string | null;
  academicYear: string | null;
  hasSemesters: boolean;
  totalSemesters: number | null;
  holidays: string[] | null;
}

export interface TenantConfigGrading {
  scheme: 'PERCENTAGE' | 'GPA' | 'CUSTOM';
  maxPercentage: number;
  passPercentage: number;
  gradeScale: Array<{ label: string; min: number; max: number }> | null;
}

export interface TenantConfigAttendance {
  thresholdPercent: number;
  requiredPerSubject: boolean;
  ruleDescription: string | null;
}

export interface TenantConfigFees {
  feeHeads: Array<{ code: string; name: string; amount: number; frequency: 'ONE_TIME' | 'PER_TERM' | 'ANNUAL'; isOptional: boolean }> | null;
  dueDate: string | null;
  lateFeePercent: number;
  concessionRules: string | null;
  refundRules: string | null;
}

export interface TenantConfigAdmissions {
  requiredFields: string[] | null;
  documentChecklist: string[] | null;
}

export interface TenantConfigNumbering {
  studentPrefix: string | null;
  admissionPrefix: string | null;
  feeReceiptPrefix: string | null;
  certificatePrefix: string | null;
  invoicePrefix: string | null;
}

export interface TenantConfigTemplates {
  certificate: Array<{ code: string; name: string; body: string }> | null;
  notification: Array<{ code: string; name: string; body: string }> | null;
}

/** The full tenant configuration document — a typed view over the JSONB `data` column. Every
 * section is optional/nullable so a freshly-provisioned tenant with only defaults still renders. */
export interface TenantConfigurationDto {
  branding: Partial<TenantConfigBranding> | null;
  academicCalendar: Partial<TenantConfigAcademicCalendar> | null;
  grading: Partial<TenantConfigGrading> | null;
  attendance: Partial<TenantConfigAttendance> | null;
  fees: Partial<TenantConfigFees> | null;
  admissions: Partial<TenantConfigAdmissions> | null;
  numbering: Partial<TenantConfigNumbering> | null;
  templates: Partial<TenantConfigTemplates> | null;
}

export interface TenantConfigurationResponseDto {
  id: string;
  tenantId: string;
  version: number;
  config: TenantConfigurationDto;
  updatedAt: string;
}
