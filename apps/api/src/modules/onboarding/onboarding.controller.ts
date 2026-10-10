import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { OnboardingService } from './onboarding.service';
import { OnboardingToken } from './onboarding-token.decorator';
import {
  ConfigureAcademicStructureDto,
  ConfigureModulesDto,
  ConfigureNotificationsDto,
  ConfirmOnboardingBrandingAssetDto,
  CreateAdministratorDto,
  CreateCollegeDto,
  CreateOnboardingAccountDto,
  OnboardingBrandingDto,
  OnboardingImportDto,
  RequestOnboardingBrandingUploadDto,
  SelectPlanDto,
  SkipOnboardingStepDto,
} from './dto/onboarding.dto';

/**
 * Public, self-service college onboarding wizard.
 *
 * Deliberately unauthenticated: a prospective college has no account or tenant yet, and the wizard
 * runs on the apex domain before its subdomain exists. Every mutating step beyond account creation
 * is authorized by the opaque `X-Onboarding-Token` minted by `POST /onboarding/account` (see
 * OnboardingService.requireSession). These routes are excluded from TenantResolutionMiddleware in
 * AppModule — tenant scoping for the writes they perform is applied explicitly and internally.
 */
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Step 1 — create the account (mints the session token). */
  @Post('account')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createAccount(@Body() dto: CreateOnboardingAccountDto, @Req() request: Request) {
    return this.onboarding.createAccount(dto, {
      ipAddress: request.ip,
      userAgent: request.header('user-agent') ?? undefined,
    });
  }

  /** Public plan catalog for step 3. */
  @Get('plans')
  listPlans() {
    return this.onboarding.listPlans();
  }

  /** Resume the wizard — the session (and its progress) for the supplied token. */
  @Get('session')
  getSession(@OnboardingToken() token: string | undefined) {
    return this.onboarding.getSession(token);
  }

  /** Module catalog with the tenant's effective state (step 6). */
  @Get('modules')
  listModules(@OnboardingToken() token: string | undefined) {
    return this.onboarding.listModules(token);
  }

  /** Step 2 — create the college (tenant). */
  @Post('college')
  createCollege(@OnboardingToken() token: string | undefined, @Body() dto: CreateCollegeDto) {
    return this.onboarding.createCollege(token, dto);
  }

  /** Step 3 — select a plan (creates the subscription + materializes entitlements). */
  @Post('plan')
  selectPlan(@OnboardingToken() token: string | undefined, @Body() dto: SelectPlanDto) {
    return this.onboarding.selectPlan(token, dto);
  }

  /** Step 4 — configure branding. */
  @Post('branding')
  configureBranding(@OnboardingToken() token: string | undefined, @Body() dto: OnboardingBrandingDto) {
    return this.onboarding.configureBranding(token, dto);
  }

  /** Step 4 — request a presigned branding-asset upload URL. */
  @Post('branding/upload-url')
  brandingUploadUrl(
    @OnboardingToken() token: string | undefined,
    @Body() dto: RequestOnboardingBrandingUploadDto,
  ) {
    return this.onboarding.createBrandingUploadUrl(token, dto.kind, dto.filename, dto.mimeType);
  }

  /** Step 4 — confirm a previously uploaded branding asset. */
  @Post('branding/asset')
  brandingAsset(@OnboardingToken() token: string | undefined, @Body() dto: ConfirmOnboardingBrandingAssetDto) {
    return this.onboarding.confirmBrandingAsset(token, dto.kind, dto.storageKey);
  }

  /** Step 5 — configure the academic structure (campus/department/program/year/term). */
  @Post('academic-structure')
  academicStructure(
    @OnboardingToken() token: string | undefined,
    @Body() dto: ConfigureAcademicStructureDto,
  ) {
    return this.onboarding.configureAcademicStructure(token, dto);
  }

  /** Step 6 — configure modules (enable/disable feature flags as overrides). */
  @Post('modules')
  configureModules(@OnboardingToken() token: string | undefined, @Body() dto: ConfigureModulesDto) {
    return this.onboarding.configureModules(token, dto);
  }

  /** Step 7 — import data (CSV) for an organization entity. */
  @Post('data-import')
  dataImport(@OnboardingToken() token: string | undefined, @Body() dto: OnboardingImportDto) {
    return this.onboarding.importData(token, dto);
  }

  /** Step 8 — create/finalize the administrator. */
  @Post('administrator')
  createAdministrator(@OnboardingToken() token: string | undefined, @Body() dto: CreateAdministratorDto) {
    return this.onboarding.createAdministrator(token, dto);
  }

  /** Step 9 — configure notifications. */
  @Post('notifications')
  configureNotifications(
    @OnboardingToken() token: string | undefined,
    @Body() dto: ConfigureNotificationsDto,
  ) {
    return this.onboarding.configureNotifications(token, dto);
  }

  /** Defer an optional step. */
  @Post('skip')
  skip(@OnboardingToken() token: string | undefined, @Body() dto: SkipOnboardingStepDto) {
    return this.onboarding.skipStep(token, dto.step);
  }

  /** Step 10 — complete onboarding (activate tenant, provision roles, notify, audit). */
  @Post('complete')
  complete(@OnboardingToken() token: string | undefined) {
    return this.onboarding.complete(token);
  }
}
