import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class BrandingSectionDto {
  @IsOptional()
  @IsString()
  collegeName?: string;

  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  logoKey?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;
}

class AcademicCalendarSectionDto {
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

class AttendanceSectionDto {
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

class FeesSectionDto {
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

class NumberingSectionDto {
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

class TemplatesSectionDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  certificate?: TemplateEntryDto[] | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  notification?: TemplateEntryDto[] | null;
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
}
