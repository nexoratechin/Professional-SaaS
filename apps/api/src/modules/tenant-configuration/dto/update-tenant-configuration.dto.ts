import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX_COLOR_MESSAGE = '$property must be a hex color like #1d4ed8';

/** Certificate-specific branding overrides (falls back to the tenant's general branding). */
export class CertificateBrandingSectionDto {
  @IsOptional()
  @IsString()
  headerText?: string;

  @IsOptional()
  @IsString()
  footerText?: string;

  @IsOptional()
  @IsString()
  watermark?: string;

  @IsOptional()
  @IsString()
  signedBy?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  accentColor?: string;
}

/** Branding for generic generated PDFs (report exports, statements). */
export class PdfBrandingSectionDto {
  @IsOptional()
  @IsString()
  headerText?: string;

  @IsOptional()
  @IsString()
  footerText?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  accentColor?: string;

  @IsOptional()
  @IsBoolean()
  showCollegeName?: boolean;
}

export class BrandingSectionDto {
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
  @IsString()
  logoKey?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  faviconKey?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

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
  loginTitle?: string;

  @IsOptional()
  @IsString()
  loginSubtitle?: string;

  @IsOptional()
  @IsString()
  loginWelcomeText?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  loginBackgroundColor?: string;

  @IsOptional()
  @IsString()
  loginBackgroundKey?: string;

  @IsOptional()
  @IsString()
  loginBackgroundUrl?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: HEX_COLOR_MESSAGE })
  emailHeaderColor?: string;

  @IsOptional()
  @IsString()
  emailFooterText?: string;

  @IsOptional()
  @IsString()
  emailSignature?: string;

  @IsOptional()
  @IsEmail()
  emailSupportAddress?: string;

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
  @ValidateNested()
  @Type(() => CertificateBrandingSectionDto)
  certificate?: CertificateBrandingSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfBrandingSectionDto)
  pdf?: PdfBrandingSectionDto;
}

export class AcademicCalendarSectionDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsBoolean()
  hasSemesters?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  totalSemesters?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  holidays?: string[] | null;
}

class GradeBandDto {
  @IsString()
  label: string;

  @IsNumber()
  min: number;

  @IsNumber()
  max: number;
}

class GradingSectionDto {
  @IsOptional()
  @IsIn(['PERCENTAGE', 'GPA', 'CUSTOM'])
  scheme?: 'PERCENTAGE' | 'GPA' | 'CUSTOM';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passPercentage?: number;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  gradeScale?: GradeBandDto[] | null;
}

export class AttendanceSectionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  thresholdPercent?: number;

  @IsOptional()
  @IsBoolean()
  requiredPerSubject?: boolean;

  @IsOptional()
  @IsString()
  ruleDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  gracePeriodMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  correctionWindowHours?: number;

  @IsOptional()
  @IsBoolean()
  deviceIngestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deviceSyncEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoApplyDeviceMarks?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3600)
  ingestMaxSkewSeconds?: number;
}

class FeeHeadDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  amount: number;

  @IsIn(['ONE_TIME', 'PER_TERM', 'ANNUAL'])
  frequency: 'ONE_TIME' | 'PER_TERM' | 'ANNUAL';

  @IsBoolean()
  isOptional: boolean;
}

export class FeesSectionDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FeeHeadDto)
  feeHeads?: FeeHeadDto[] | null;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  lateFeePercent?: number;

  @IsOptional()
  @IsString()
  concessionRules?: string;

  @IsOptional()
  @IsString()
  refundRules?: string;
}

class AdmissionsSectionDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredFields?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentChecklist?: string[] | null;
}

export class NumberingSectionDto {
  @IsOptional()
  @IsString()
  studentPrefix?: string;

  @IsOptional()
  @IsString()
  admissionPrefix?: string;

  @IsOptional()
  @IsString()
  feeReceiptPrefix?: string;

  @IsOptional()
  @IsString()
  certificatePrefix?: string;

  @IsOptional()
  @IsString()
  invoicePrefix?: string;
}

class TemplateEntryDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsString()
  body: string;
}

export class TemplatesSectionDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  certificate?: TemplateEntryDto[] | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  notification?: TemplateEntryDto[] | null;
}

export class CampusPoliciesSectionDto {
  @IsOptional()
  @IsBoolean()
  campusSettingsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  campusAnalyticsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowCampusAdminRole?: boolean;

  @IsOptional()
  @IsString()
  defaultTimezone?: string | null;
}

/** PATCH body for the tenant configuration document. Only the section(s) provided are merged
 * into the existing document (deep-per-section replace); absent sections are left untouched. */
export class UpdateTenantConfigurationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingSectionDto)
  branding?: BrandingSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcademicCalendarSectionDto)
  academicCalendar?: AcademicCalendarSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => GradingSectionDto)
  grading?: GradingSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttendanceSectionDto)
  attendance?: AttendanceSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeesSectionDto)
  fees?: FeesSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdmissionsSectionDto)
  admissions?: AdmissionsSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NumberingSectionDto)
  numbering?: NumberingSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplatesSectionDto)
  templates?: TemplatesSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampusPoliciesSectionDto)
  policies?: CampusPoliciesSectionDto;
}
