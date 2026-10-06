import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IMPORT_ENTITY_KEYS } from '@college-erp/imports';

export const IMPORT_ENTITY_VALUES = IMPORT_ENTITY_KEYS;

export class UploadUrlDto {
  @IsString() fileName!: string;
  @IsOptional() @IsInt() @Min(0) sizeBytes?: number;
}

export class ImportJobOptionsDto {
  @IsOptional() @IsIn(['SKIP', 'UPDATE', 'FAIL']) duplicateStrategy?: 'SKIP' | 'UPDATE' | 'FAIL';
  @IsOptional() @IsBoolean() updateExisting?: boolean;
}

export class PreviewImportDto {
  @IsString() storageKey!: string;
  @IsOptional() @IsObject() mapping?: Record<string, string>;
  @IsOptional() @IsIn(['SKIP', 'UPDATE', 'FAIL']) duplicateStrategy?: 'SKIP' | 'UPDATE' | 'FAIL';
  @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
}

export class CreateImportJobDto {
  @IsString() storageKey!: string;
  @IsString() fileName!: string;
  @IsOptional() @IsIn(['CSV', 'XLSX']) format?: 'CSV' | 'XLSX';
  @IsOptional() @IsIn(['COMMIT', 'VALIDATE']) mode?: 'COMMIT' | 'VALIDATE';
  @IsOptional() @IsObject() mapping?: Record<string, string>;
  @IsOptional() @ValidateNested() @Type(() => ImportJobOptionsDto) options?: ImportJobOptionsDto;
}

export class ListImportJobsDto {
  @IsOptional() @IsIn(IMPORT_ENTITY_VALUES) entity?: string;
  @IsOptional() @IsIn(['PENDING', 'VALIDATING', 'VALIDATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take?: number;
}

export class ListImportRowsDto {
  @IsOptional() @IsIn(['VALID', 'INVALID', 'DUPLICATE', 'SKIPPED', 'INSERTED', 'UPDATED', 'FAILED']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
}

export class SaveImportTemplateDto {
  @IsIn(IMPORT_ENTITY_VALUES) entity!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsObject() mapping!: Record<string, string>;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class ExportEntityDto {
  @IsOptional() @IsIn(['CSV', 'XLSX']) format?: 'CSV' | 'XLSX';
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50_000) take?: number;
}
