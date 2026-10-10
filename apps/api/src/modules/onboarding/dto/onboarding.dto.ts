import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX_COLOR_MESSAGE = '$property must be a hex color like #1d4ed8';
const SLUG = /^[a-z0-9-]+$/;

// ── Step 1: create account ────────────────────────────────────────────────────

export class CreateOnboardingAccountDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsStrongPassword()
  password!: string;
}

// ── Step 2: create college ────────────────────────────────────────────────────

export class CreateCollegeDto {
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase alphanumeric with hyphens only' })
  @MinLength(3)
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

// ── Step 3: select plan ───────────────────────────────────────────────────────

export class SelectPlanDto {
  @IsString()
  planCode!: string;
}

// ── Step 4: configure branding ────────────────────────────────────────────────

export class OnboardingBrandingDto {
  @IsOptional()
  @IsString()
  collegeName?: string;

  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  portalName?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  secondaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  accentColor?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  loginTitle?: string;

  @IsOptional()
  @IsString()
  loginSubtitle?: string;
}

export class RequestOnboardingBrandingUploadDto {
  @IsIn(['logo', 'favicon', 'loginBackground'])
  kind!: 'logo' | 'favicon' | 'loginBackground';

  @IsString()
  filename!: string;

  @IsString()
  mimeType!: string;
}

export class ConfirmOnboardingBrandingAssetDto {
  @IsIn(['logo', 'favicon', 'loginBackground'])
  kind!: 'logo' | 'favicon' | 'loginBackground';

  @IsString()
  storageKey!: string;
}

// ── Step 5: configure academic structure ──────────────────────────────────────

export class OnboardingCampusDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

export class OnboardingDepartmentDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Code of a campus supplied in the same request (resolved to its id server-side). */
  @IsOptional()
  @IsString()
  campusCode?: string;
}

export class OnboardingProgramDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  degreeLevel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  durationYears?: number;

  /** Code of a department supplied in the same request (resolved to its id server-side). */
  @IsOptional()
  @IsString()
  departmentCode?: string;
}

export class OnboardingAcademicYearDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

export class OnboardingTermDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

export class ConfigureAcademicStructureDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnboardingCampusDto)
  campuses?: OnboardingCampusDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnboardingDepartmentDto)
  departments?: OnboardingDepartmentDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnboardingProgramDto)
  programs?: OnboardingProgramDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingAcademicYearDto)
  academicYear?: OnboardingAcademicYearDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnboardingTermDto)
  terms?: OnboardingTermDto[];
}

// ── Step 6: configure modules ─────────────────────────────────────────────────

export class ConfigureModulesDto {
  /** Module (feature) keys to explicitly enable as add-ons beyond the plan's included set. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enable?: string[];

  /** Module keys to explicitly disable for this tenant. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  disable?: string[];
}

// ── Step 7: import data ───────────────────────────────────────────────────────

const IMPORTABLE_ENTITIES = [
  'campus',
  'department',
  'program',
  'academicYear',
  'term',
  'room',
  'building',
  'section',
  'batch',
] as const;

export class OnboardingImportDto {
  @IsIn(IMPORTABLE_ENTITIES as unknown as string[])
  entity!: (typeof IMPORTABLE_ENTITIES)[number];

  @IsString()
  csv!: string;

  @IsOptional()
  @IsIn(['validate', 'upsert'])
  mode?: 'validate' | 'upsert';
}

// ── Step 8: create administrator ──────────────────────────────────────────────

export class CreateAdministratorDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Optional new password for the administrator; omit to keep the account password. */
  @IsOptional()
  @IsStrongPassword()
  password?: string;
}

// ── Step 9: configure notifications ───────────────────────────────────────────

const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;

export class ConfigureNotificationsDto {
  @IsOptional()
  @IsArray()
  @IsIn(NOTIFICATION_CHANNELS as unknown as string[], { each: true })
  channels?: string[];

  @IsOptional()
  @IsString()
  senderName?: string;

  @IsOptional()
  @IsEmail()
  senderEmail?: string;

  @IsOptional()
  @IsEmail()
  replyToEmail?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;
}

// ── Skip an optional step ─────────────────────────────────────────────────────

export class SkipOnboardingStepDto {
  @IsIn(['BRANDING', 'ACADEMIC_STRUCTURE', 'MODULES', 'DATA_IMPORT', 'NOTIFICATIONS'])
  step!: 'BRANDING' | 'ACADEMIC_STRUCTURE' | 'MODULES' | 'DATA_IMPORT' | 'NOTIFICATIONS';
}
