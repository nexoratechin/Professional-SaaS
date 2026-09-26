import { REPORT_EXPORT_FORMATS, REPORT_TYPES } from '@college-erp/reporting';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export { REPORT_EXPORT_FORMATS, REPORT_TYPES };
export const REPORT_RUN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED'] as const;
export const REPORT_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export const REPORT_DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

const MAX_PAGE_SIZE = 100;
const MAX_TEMPLATE_COLUMNS = 100;

export class ReportFiltersDto {
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class PreviewReportDto {
  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsUUID()
  savedReportId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;
}

export class CreateReportExportDto extends PreviewReportDto {
  @IsIn(REPORT_EXPORT_FORMATS)
  format!: string;
}

export class ListReportRunsDto {
  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsIn(REPORT_RUN_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  take?: number;
}

export class CreateSavedReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(REPORT_TYPES)
  reportType!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;
}

export class UpdateSavedReportDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;
}

export class ListSavedReportsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  take?: number;
}

export class ReportTemplateColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z][A-Za-z0-9_.-]*$/)
  key!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsIn(['LEFT', 'CENTER', 'RIGHT'])
  align?: string;
}

export class ReportTemplateDefinitionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TEMPLATE_COLUMNS)
  @ValidateNested({ each: true })
  @Type(() => ReportTemplateColumnDto)
  columns!: ReportTemplateColumnDto[];

  @IsOptional()
  @IsBoolean()
  showTotals?: boolean;
}

export class CreateReportTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(REPORT_TYPES)
  reportType!: string;

  @ValidateNested()
  @Type(() => ReportTemplateDefinitionDto)
  definition!: ReportTemplateDefinitionDto;
}

export class UpdateReportTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportTemplateDefinitionDto)
  definition?: ReportTemplateDefinitionDto;
}

export class ListReportTemplatesDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  take?: number;
}

export class CreateReportScheduleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(REPORT_TYPES)
  reportType!: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsIn(REPORT_EXPORT_FORMATS)
  format!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;

  @IsIn(REPORT_SCHEDULE_FREQUENCIES)
  frequency!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone!: string;

  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  timeOfDay!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  @Type(() => Number)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  dayOfMonth?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateReportScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @IsOptional()
  @IsIn(REPORT_EXPORT_FORMATS)
  format?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;

  @IsOptional()
  @IsIn(REPORT_SCHEDULE_FREQUENCIES)
  frequency?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  timeOfDay?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  @Type(() => Number)
  dayOfWeek?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  dayOfMonth?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListReportSchedulesDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(REPORT_TYPES)
  reportType?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  take?: number;
}
