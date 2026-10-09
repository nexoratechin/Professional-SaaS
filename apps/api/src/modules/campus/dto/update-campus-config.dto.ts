import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import {
  AcademicCalendarSectionDto,
  AttendanceSectionDto,
  BrandingSectionDto,
  FeesSectionDto,
  NumberingSectionDto,
  TemplatesSectionDto,
} from '../../tenant-configuration/dto/update-tenant-configuration.dto';

/**
 * PATCH body for one campus's configuration document (GET/PATCH /campuses/:campusId/config).
 * Only the section(s) present are merged into the existing document (deep-per-section replace
 * for object sections, exact replace for the scalar `timezone`); absent sections are untouched.
 * The section shapes are the same as the tenant configuration engine's — a campus document is
 * the same kind of JSON config document, just scoped to one campus.
 */
export class UpdateCampusConfigDto {
  /** IANA timezone; `null` explicitly clears the campus override (falls back to the global default). */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  timezone?: string | null;

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
  @Type(() => AttendanceSectionDto)
  attendance?: AttendanceSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FeesSectionDto)
  fees?: FeesSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NumberingSectionDto)
  numbering?: NumberingSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplatesSectionDto)
  templates?: TemplatesSectionDto;
}