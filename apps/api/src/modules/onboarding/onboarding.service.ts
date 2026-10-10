import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  FEATURE_FLAG_CATALOG,
  type FeatureKey,
} from '@college-erp/auth';
import { createTenantScopedClient, type OnboardingSession, type Prisma } from '@college-erp/database';
import {
  ONBOARDING_OPTIONAL_STEPS,
  ONBOARDING_STEPS,
  type OnboardingCompletionDto,
  type OnboardingImportResultDto,
  type OnboardingModuleOptionDto,
  type OnboardingPlanOptionDto,
  type OnboardingSessionDto,
  type OnboardingStep,
} from '@college-erp/types';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationService } from '../organization/organization.service';
import type { EntityName } from '../organization/organization.constants';
import { EntitlementsService } from '../rbac/entitlements.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import type { UpdateTenantConfigurationDto } from '../tenant-configuration/dto/update-tenant-configuration.dto';
import { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { TenantProvisioningService } from '../tenants/tenant-provisioning.service';
import {
  type ConfigureAcademicStructureDto,
  type ConfigureModulesDto,
  type ConfigureNotificationsDto,
  type CreateAdministratorDto,
  type CreateCollegeDto,
  type CreateOnboardingAccountDto,
  type OnboardingBrandingDto,
  type OnboardingImportDto,
  type SelectPlanDto,
} from './dto/onboarding.dto';

/** How long a paused wizard can be resumed before its session is treated as abandoned. */
const SESSION_TTL_DAYS = 30;

/** Slugs that would collide with platform routes/subdomains and must never become tenants. */
const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'platform', 'public', 'auth', 'login', 'onboarding',
  'portal', 'parent', 'faculty', 'static', 'assets', 'health', 'metrics', 'docs',
]);

/** Default notification templates every onboarded tenant starts with (rendered by the worker). */
const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    code: 'WELCOME',
    name: 'Welcome',
    channel: 'EMAIL' as const,
    subjectTemplate: 'Welcome to {{collegeName}}',
    bodyTemplate: 'Hello {{fullName}},\n\nWelcome to {{collegeName}} on College ERP. Your administrator account is ready.\n\n— {{collegeName}}',
  },
  {
    code: 'PASSWORD_RESET',
    name: 'Password reset',
    channel: 'EMAIL' as const,
    subjectTemplate: 'Reset your {{collegeName}} password',
    bodyTemplate: 'Hello {{fullName}},\n\nUse this link to reset your password: {{resetUrl}}\n\nIf you did not request this, you can ignore this email.',
  },
  {
    code: 'GENERAL_NOTICE',
    name: 'General notice',
    channel: 'IN_APP' as const,
    subjectTemplate: '{{title}}',
    bodyTemplate: '{{message}}',
  },
];

/**
 * Self-service college onboarding wizard (ten steps).
 *
 * Reuses — rather than re-implements — the platform's existing engines: TenantProvisioningService
 * (roles/permissions/admin/workflows), TenantConfigurationService (branding + config document),
 * OrganizationService (academic structure + CSV import), EntitlementsService/TenantFeaturesService
 * (plan-derived module entitlements), NotificationsService (welcome notification) and AuditService
 * (the centralized trail). The only new persistence is OnboardingSession: a resumable, token-
 * authorized record of how far a prospective college has got.
 *
 * Authorization model: the wizard is public (no JWT) and every non-public method requires the
 * opaque session token issued by createAccount(), sent as `X-Onboarding-Token`. The token is stored
 * only as a SHA-256 hash. A tenant-scoped Prisma client is used for tenant data, so the wizard
 * writes are subject to the same row-level tenant guard as every other tenant service.
 *
 * Actor attribution: because no tenant user can exist before the tenant does, step 2 (create
 * college) immediately provisions the account as an INVITED user, so steps 3–9 write through
 * services that require a real actorUserId. Completion then activates that user and attaches the
 * seeded admin role via TenantProvisioningService (no duplicate user).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantConfiguration: TenantConfigurationService,
    private readonly branding: BrandingService,
    private readonly organization: OrganizationService,
    private readonly entitlements: EntitlementsService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly notifications: NotificationsService,
    private readonly tenantLookup: TenantLookupService,
  ) {}

  // ── Public catalog ───────────────────────────────────────────────────────────

  /** Active plans offered in step 3, with the module/entitlement keys each grants. */
  async listPlans(): Promise<OnboardingPlanOptionDto[]> {
    const plans = await this.platformPrisma.client.plan.findMany({
      where: { isActive: true },
      include: { planFeatures: { include: { featureFlag: true } }, planModules: true },
      orderBy: { createdAt: 'asc' },
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceCents: plan.priceCents,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      isCustom: plan.isCustom,
      features: plan.planFeatures.map((pf) => pf.featureFlag.key),
      entitlements: plan.planModules.map((pm) => pm.moduleKey),
    }));
  }

  // ── Step 1: create account ───────────────────────────────────────────────────

  async createAccount(dto: CreateOnboardingAccountDto, meta: { ipAddress?: string; userAgent?: string }) {
    const existing = await this.platformPrisma.client.onboardingSession.findFirst({
      where: { accountEmail: dto.email, status: 'IN_PROGRESS', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      // Re-issuing a fresh token for the same in-progress email would leave the first token valid;
      // simpler and safer to refuse and let the wizard resume with the original token.
      throw new ConflictException(
        'An onboarding session is already in progress for this email. Resume it or wait for it to expire.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.platformPrisma.client.onboardingSession.create({
      data: {
        accountEmail: dto.email.toLowerCase(),
        accountFullName: dto.fullName,
        accountPasswordHash: passwordHash,
        tokenHash: this.hashToken(token),
        status: 'IN_PROGRESS',
        currentStep: 2,
        completedSteps: ['ACCOUNT'],
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt,
      },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.ONBOARDING_STARTED,
      module: AUDIT_MODULES.ONBOARDING,
      entityType: 'OnboardingSession',
      entityId: session.id,
      after: { accountEmail: session.accountEmail },
    });

    return { onboardingToken: token, session: this.toSessionDto(session) };
  }

  // ── Session reads ─────────────────────────────────────────────────────────────

  async getSession(token: string | undefined): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    return this.toSessionDto(session);
  }

  /** Module toggles offered in step 6 — catalog with the tenant's effective state and plan inclusion. */
  async listModules(token: string | undefined): Promise<OnboardingModuleOptionDto[]> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    this.useTenant(session);

    const [effective, plan] = await Promise.all([
      this.tenantFeatures.getEffectiveFeatures(tenantId),
      this.getActivePlanForTenant(tenantId),
    ]);
    const includedInPlan = new Set(plan?.planFeatures.map((pf) => pf.featureFlag.key) ?? []);

    return FEATURE_FLAG_CATALOG.map((entry) => ({
      key: entry.key,
      name: entry.name,
      module: entry.module,
      enabled: effective[entry.key as FeatureKey] === true,
      includedInPlan: includedInPlan.has(entry.key),
    }));
  }

  // ── Step 2: create college ────────────────────────────────────────────────────

  async createCollege(token: string | undefined, dto: CreateCollegeDto): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    if (session.tenantId) {
      throw new ConflictException('This onboarding session already has a college.');
    }

    const slug = dto.slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`The slug "${slug}" is reserved. Choose another.`);
    }
    const clash = await this.platformPrisma.client.tenant.findUnique({ where: { slug } });
    if (clash) {
      throw new ConflictException(`The slug "${slug}" is already taken.`);
    }

    const tenant = await this.platformPrisma.client.tenant.create({
      data: {
        slug,
        name: dto.name,
        billingEmail: dto.billingEmail?.toLowerCase() ?? session.accountEmail,
        timezone: dto.timezone ?? 'Asia/Kolkata',
        status: 'TRIAL',
      },
    });

    // Provision the account as the tenant's first user straight away (INVITED — it cannot sign in
    // until completion flips it ACTIVE with a role), so steps 3–9 have a real actor to audit.
    const tenantClient = createTenantScopedClient(tenant.id);
    const adminUser = await tenantClient.user.create({
      data: {
        tenantId: tenant.id,
        email: session.accountEmail,
        fullName: session.accountFullName,
        passwordHash: session.accountPasswordHash,
        status: 'INVITED',
        createdBy: session.id,
      },
    });

    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        adminUserId: adminUser.id,
        adminEmail: session.accountEmail,
        adminFullName: session.accountFullName,
        ...this.progress(session, 'COLLEGE', 3),
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: tenant.id,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.ONBOARDING_STEP_COMPLETED,
      module: AUDIT_MODULES.ONBOARDING,
      entityType: 'Tenant',
      entityId: tenant.id,
      after: { step: 'COLLEGE', slug: tenant.slug, name: tenant.name },
    });

    return this.toSessionDto(updated);
  }

  // ── Step 3: select plan ───────────────────────────────────────────────────────

  async selectPlan(token: string | undefined, dto: SelectPlanDto): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);

    const plan = await this.platformPrisma.client.plan.findUnique({
      where: { code: dto.planCode },
      include: { planFeatures: { include: { featureFlag: true } }, planModules: true },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException(`Unknown or inactive plan: ${dto.planCode}`);
    }

    const { start, end } = this.billingPeriod(plan.billingCycle);
    // Self-service subscription creation is intentionally done here (not via SaasService
    // .createSubscription, which attributes the write to a platform admin and audits PLATFORM
    // scope). The row shape and the entitlement recompute are identical.
    const existing = await this.platformPrisma.client.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.platformPrisma.client.subscription.update({
        where: { id: existing.id },
        data: {
          planId: plan.id,
          billingCycle: plan.billingCycle,
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });
    } else {
      await this.platformPrisma.client.subscription.create({
        data: {
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          billingCycle: plan.billingCycle,
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });
    }

    await this.entitlements.recompute(tenantId);

    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: { planCode: plan.code, ...this.progress(session, 'PLAN', 4) },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.ONBOARDING_STEP_COMPLETED,
      module: AUDIT_MODULES.ONBOARDING,
      entityType: 'Subscription',
      after: { step: 'PLAN', planCode: plan.code, billingCycle: plan.billingCycle },
    });

    return this.toSessionDto(updated);
  }

  // ── Step 4: configure branding ────────────────────────────────────────────────

  async configureBranding(token: string | undefined, dto: OnboardingBrandingDto): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const actor = this.requireActor(session);

    await this.tenantConfiguration.update(
      tenantId,
      { branding: dto } as UpdateTenantConfigurationDto,
      actor,
    );

    return this.completeStep(session, 'BRANDING', 5, { branding: dto });
  }

  async createBrandingUploadUrl(token: string | undefined, kind: string, filename: string, mimeType: string) {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    return this.branding.createUploadUrl(tenantId, kind as never, { filename, mimeType });
  }

  async confirmBrandingAsset(token: string | undefined, kind: string, storageKey: string) {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const asset = await this.branding.confirmAsset(tenantId, kind as never, storageKey);
    return { step: 'BRANDING', asset };
  }

  // ── Step 5: configure academic structure ─────────────────────────────────────

  async configureAcademicStructure(
    token: string | undefined,
    dto: ConfigureAcademicStructureDto,
  ): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const actor = this.requireActor(session);
    this.useTenant(session);

    const campusIdByCode = new Map<string, string>();
    for (const campus of dto.campuses ?? []) {
      const created = await this.organization.create('campus', tenantId, actor, {
        code: campus.code,
        name: campus.name,
        addressLine: campus.addressLine,
        city: campus.city,
        state: campus.state,
        country: campus.country ?? 'India',
        isActive: true,
      });
      campusIdByCode.set(campus.code, created.id);
    }

    const departmentIdByCode = new Map<string, string>();
    for (const department of dto.departments ?? []) {
      const campusId = department.campusCode ? campusIdByCode.get(department.campusCode) : undefined;
      const created = await this.organization.create('department', tenantId, actor, {
        code: department.code,
        name: department.name,
        description: department.description,
        campusId,
        isActive: true,
      });
      departmentIdByCode.set(department.code, created.id);
    }

    for (const program of dto.programs ?? []) {
      const departmentId = program.departmentCode ? departmentIdByCode.get(program.departmentCode) : undefined;
      await this.organization.create('program', tenantId, actor, {
        code: program.code,
        name: program.name,
        degreeLevel: program.degreeLevel,
        durationYears: program.durationYears,
        departmentId,
        isActive: true,
      });
    }

    let academicYearId: string | undefined;
    if (dto.academicYear) {
      const created = await this.organization.create('academicYear', tenantId, actor, {
        code: dto.academicYear.code,
        name: dto.academicYear.name,
        startDate: new Date(dto.academicYear.startDate),
        endDate: new Date(dto.academicYear.endDate),
        isCurrent: dto.academicYear.isCurrent ?? true,
      });
      academicYearId = created.id;
    }

    for (const term of dto.terms ?? []) {
      await this.organization.create('term', tenantId, actor, {
        code: term.code,
        name: term.name,
        sequence: term.sequence ?? 1,
        startDate: term.startDate ? new Date(term.startDate) : undefined,
        endDate: term.endDate ? new Date(term.endDate) : undefined,
        isCurrent: term.isCurrent ?? false,
        academicYearId,
      });
    }

    const summary = {
      campuses: dto.campuses?.length ?? 0,
      departments: dto.departments?.length ?? 0,
      programs: dto.programs?.length ?? 0,
      terms: dto.terms?.length ?? 0,
      academicYear: dto.academicYear?.code ?? null,
    };

    return this.completeStep(session, 'ACADEMIC_STRUCTURE', 6, { academicStructure: summary });
  }

  // ── Step 6: configure modules ─────────────────────────────────────────────────

  async configureModules(token: string | undefined, dto: ConfigureModulesDto): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);

    const enable = dto.enable ?? [];
    const disable = dto.disable ?? [];
    const keys = [...new Set([...enable, ...disable])];
    if (keys.length > 0) {
      const flags = await this.platformPrisma.client.featureFlag.findMany({ where: { key: { in: keys } } });
      const flagByKey = new Map(flags.map((flag) => [flag.key, flag.id]));
      if (flagByKey.size !== keys.length) {
        const unknown = keys.filter((key) => !flagByKey.has(key));
        throw new BadRequestException(`Unknown module key(s): ${unknown.join(', ')}`);
      }

      for (const key of keys) {
        const featureFlagId = flagByKey.get(key) as string;
        const enabled = enable.includes(key);
        await this.platformPrisma.client.tenantFeatureFlag.upsert({
          where: { tenantId_featureFlagId: { tenantId, featureFlagId } },
          update: { enabled, reason: 'Onboarding module selection' },
          create: {
            tenantId,
            featureFlagId,
            enabled,
            reason: 'Onboarding module selection',
            createdByPlatformUserId: session.id,
          },
        });
      }
      await this.tenantFeatures.invalidate(tenantId);
    }

    return this.completeStep(session, 'MODULES', 7, { modules: { enable, disable } });
  }

  // ── Step 7: import data ───────────────────────────────────────────────────────

  async importData(token: string | undefined, dto: OnboardingImportDto): Promise<OnboardingImportResultDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const actor = this.requireActor(session);
    this.useTenant(session);

    const result = await this.organization.importCsv(
      dto.entity as EntityName,
      tenantId,
      actor,
      dto.csv,
      dto.mode ?? 'upsert',
    );

    await this.completeStep(session, 'DATA_IMPORT', 8, {
      dataImport: { entity: result.entity, total: result.total, inserted: result.inserted, updated: result.updated },
    });

    return result as OnboardingImportResultDto;
  }

  // ── Step 8: create administrator ──────────────────────────────────────────────

  async createAdministrator(
    token: string | undefined,
    dto: CreateAdministratorDto,
  ): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const adminUserId = this.requireActor(session);

    const data: Prisma.UserUpdateInput = {};
    if (dto.email) data.email = dto.email.toLowerCase();
    if (dto.fullName) data.fullName = dto.fullName;
    if (dto.phone) data.phone = dto.phone;
    let newPasswordHash: string | undefined;
    if (dto.password) {
      newPasswordHash = await bcrypt.hash(dto.password, 12);
      data.passwordHash = newPasswordHash;
    }

    if (Object.keys(data).length > 0) {
      const tenantClient = createTenantScopedClient(tenantId);
      await tenantClient.user.update({ where: { id: adminUserId }, data });
    }

    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: {
        adminEmail: dto.email?.toLowerCase() ?? session.adminEmail,
        adminFullName: dto.fullName ?? session.adminFullName,
        ...(newPasswordHash ? { accountPasswordHash: newPasswordHash } : {}),
        ...this.progress(session, 'ADMINISTRATOR', 9),
      },
    });

    return this.toSessionDto(updated);
  }

  // ── Step 9: configure notifications ───────────────────────────────────────────

  async configureNotifications(
    token: string | undefined,
    dto: ConfigureNotificationsDto,
  ): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const actor = this.requireActor(session);

    // Sender identity lives in the tenant configuration document's branding section (same place the
    // settings page writes it), so onboarding and post-onboarding edits converge on one source.
    const brandingPatch: Record<string, string> = {};
    if (dto.senderName) brandingPatch.senderName = dto.senderName;
    if (dto.senderEmail) brandingPatch.senderEmail = dto.senderEmail;
    if (dto.replyToEmail) brandingPatch.replyToEmail = dto.replyToEmail;
    if (dto.supportEmail) brandingPatch.emailSupportAddress = dto.supportEmail;
    if (Object.keys(brandingPatch).length > 0) {
      await this.tenantConfiguration.update(tenantId, { branding: brandingPatch } as UpdateTenantConfigurationDto, actor);
    }

    // Ensure the standard templates exist so event-triggered notifications have something to render.
    const tenantClient = createTenantScopedClient(tenantId);
    for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
      await tenantClient.notificationTemplate.upsert({
        where: { tenantId_code: { tenantId, code: template.code } },
        update: { name: template.name },
        create: {
          tenantId,
          code: template.code,
          name: template.name,
          channel: template.channel,
          subjectTemplate: template.subjectTemplate,
          bodyTemplate: template.bodyTemplate,
          isActive: true,
          createdBy: actor,
        },
      });
    }

    return this.completeStep(session, 'NOTIFICATIONS', 10, {
      notifications: {
        channels: dto.channels ?? ['EMAIL', 'IN_APP'],
        senderName: dto.senderName ?? null,
        senderEmail: dto.senderEmail ?? null,
      },
    });
  }

  // ── Skip an optional step ─────────────────────────────────────────────────────

  async skipStep(token: string | undefined, step: OnboardingStep): Promise<OnboardingSessionDto> {
    const session = await this.requireSession(token);
    if (!ONBOARDING_OPTIONAL_STEPS.includes(step)) {
      throw new BadRequestException(`${step} is required and cannot be skipped.`);
    }
    const index = ONBOARDING_STEPS.indexOf(step) + 1;
    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: this.progress(session, step, index),
    });
    return this.toSessionDto(updated);
  }

  // ── Step 10: complete onboarding ──────────────────────────────────────────────

  async complete(token: string | undefined): Promise<OnboardingCompletionDto> {
    const session = await this.requireSession(token);
    const tenantId = this.requireTenant(session);
    const adminUserId = this.requireActor(session);
    this.useTenant(session);

    const adminEmail = session.adminEmail ?? session.accountEmail;
    const adminFullName = session.adminFullName ?? session.accountFullName;

    // 1) Roles + permissions + workflow defaults, attached to the INVITED user from step 2, and
    //    flip it ACTIVE (the post-onboarding "default roles/permissions created" contract).
    const provisioned = await this.provisioning.provisionDefaultAdmin({
      tenantId,
      email: adminEmail,
      fullName: adminFullName,
      passwordHash: session.accountPasswordHash,
      existingUserId: adminUserId,
      createdBy: session.id,
    });

    // 2) Initialize the configuration document (find-or-create) so the tenant is never in a
    //    "no configuration" state after onboarding.
    await this.tenantConfiguration.get(tenantId);

    // 3) Activate the tenant (TRIAL -> ACTIVE) and drop the cached lookup so the new status is used
    //    on the very next request.
    const tenant = await this.platformPrisma.client.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
    });
    await this.tenantLookup.invalidate(tenant.slug);

    // 4) Welcome notification to the new administrator (in-app; the worker delivers it).
    let welcomeNotificationSent = false;
    try {
      await this.notifications.sendSystem(tenantId, {
        recipientUserId: provisioned.adminUserId,
        channel: 'IN_APP',
        subject: `Welcome to ${tenant.name}`,
        body:
          `Your College ERP workspace for ${tenant.name} is ready. ` +
          `Sign in at the ${tenant.slug} workspace with ${adminEmail} to get started.`,
      });
      welcomeNotificationSent = true;
    } catch {
      // A queue/Redis outage must not fail the completion itself — the notification is retried by
      // the worker's normal redelivery once the infrastructure recovers.
      welcomeNotificationSent = false;
    }

    // 5) Mark the session complete and record the completion in the audit trail.
    const completedAt = new Date();
    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        currentStep: 10,
        completedSteps: ONBOARDING_STEPS as unknown as Prisma.InputJsonValue,
        completedAt,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.ONBOARDING_COMPLETED,
      module: AUDIT_MODULES.ONBOARDING,
      entityType: 'Tenant',
      entityId: tenantId,
      after: {
        slug: tenant.slug,
        planCode: session.planCode,
        rolesCreated: provisioned.rolesCreated,
        permissionsGranted: provisioned.permissionsGranted,
        welcomeNotificationSent,
      },
    });

    void updated;

    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, status: 'ACTIVE' },
      admin: { id: provisioned.adminUserId, email: adminEmail, fullName: adminFullName },
      rolesCreated: provisioned.rolesCreated,
      permissionsGranted: provisioned.permissionsGranted,
      configurationInitialized: true,
      welcomeNotificationSent,
      completedAt: completedAt.toISOString(),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private async completeStep(
    session: OnboardingSession,
    step: OnboardingStep,
    nextStep: number,
    data: Record<string, unknown>,
  ): Promise<OnboardingSessionDto> {
    const current = (session.data ?? {}) as Record<string, unknown>;
    const updated = await this.platformPrisma.client.onboardingSession.update({
      where: { id: session.id },
      data: {
        data: { ...current, ...data } as Prisma.InputJsonValue,
        ...this.progress(session, step, nextStep),
      },
    });
    return this.toSessionDto(updated);
  }

  /** Merges a step into completedSteps and advances currentStep monotonically. */
  private progress(
    session: OnboardingSession,
    step: OnboardingStep,
    nextStep: number,
  ): { completedSteps: Prisma.InputJsonValue; currentStep: number } {
    const existing = Array.isArray(session.completedSteps) ? (session.completedSteps as unknown[]) : [];
    const set = new Set<string>([...existing.map(String), step]);
    return {
      completedSteps: ONBOARDING_STEPS.filter((candidate) => set.has(candidate)) as unknown as Prisma.InputJsonValue,
      currentStep: Math.max(session.currentStep, nextStep),
    };
  }

  private async requireSession(token: string | undefined): Promise<OnboardingSession> {
    if (!token) {
      throw new UnauthorizedException('Missing onboarding token.');
    }
    const session = await this.platformPrisma.client.onboardingSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!session) {
      throw new UnauthorizedException('Invalid onboarding token.');
    }
    if (session.status === 'ABANDONED') {
      throw new UnauthorizedException('This onboarding session was abandoned.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.platformPrisma.client.onboardingSession.update({
        where: { id: session.id },
        data: { status: 'ABANDONED' },
      });
      throw new UnauthorizedException('This onboarding session has expired. Please start a new one.');
    }
    if (session.status === 'COMPLETED') {
      throw new ConflictException('This onboarding session is already complete.');
    }
    return session;
  }

  private requireTenant(session: OnboardingSession): string {
    if (!session.tenantId) {
      throw new BadRequestException('Create your college (step 2) before this step.');
    }
    return session.tenantId;
  }

  private requireActor(session: OnboardingSession): string {
    if (!session.adminUserId) {
      throw new BadRequestException('The onboarding administrator has not been provisioned yet.');
    }
    return session.adminUserId;
  }

  private useTenant(session: OnboardingSession): void {
    if (session.tenantId && session.tenantSlug) {
      this.tenantContext.setTenant(session.tenantId, session.tenantSlug);
    }
  }

  private getActivePlanForTenant(tenantId: string) {
    return this.platformPrisma.client.subscription
      .findFirst({
        where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
        include: { plan: { include: { planFeatures: { include: { featureFlag: true } } } } },
      })
      .then((subscription) => subscription?.plan ?? null);
  }

  private billingPeriod(cycle: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME'): { start: Date; end: Date } {
    const start = new Date();
    const end = new Date(start);
    if (cycle === 'MONTHLY') {
      end.setMonth(end.getMonth() + 1);
    } else if (cycle === 'ONE_TIME') {
      end.setFullYear(end.getFullYear() + 100);
    } else {
      end.setFullYear(end.getFullYear() + 1);
    }
    return { start, end };
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toSessionDto(session: OnboardingSession): OnboardingSessionDto {
    return {
      id: session.id,
      status: session.status,
      currentStep: session.currentStep,
      completedSteps: Array.isArray(session.completedSteps)
        ? (session.completedSteps as OnboardingStep[])
        : [],
      accountEmail: session.accountEmail,
      accountFullName: session.accountFullName,
      tenantId: session.tenantId,
      tenantSlug: session.tenantSlug,
      tenantName: session.tenantName,
      planCode: session.planCode,
      adminEmail: session.adminEmail,
      adminFullName: session.adminFullName,
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      expiresAt: session.expiresAt.toISOString(),
      data: (session.data ?? {}) as Record<string, unknown>,
    };
  }
}

export { SESSION_TTL_DAYS };
