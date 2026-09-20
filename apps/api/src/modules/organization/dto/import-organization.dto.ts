import { IsIn, IsOptional, IsString } from 'class-validator';
import { ORGANIZATION_ENTITIES, type OrganizationEntity } from './list-organization.dto';

/** CSV import body (synchronous). mode=validate → dry-run only. */
export class ImportOrganizationDto {
  @IsIn(ORGANIZATION_ENTITIES) entity!: OrganizationEntity;
  @IsString() csv!: string;
  @IsOptional() @IsIn(['validate', 'upsert']) mode?: 'validate' | 'upsert';
}

export interface ImportResultRow {
  row: number;
  code: string;
  success: boolean;
  id?: string;
  error?: string;
}

export interface ImportResult {
  entity: string;
  mode: 'validate' | 'upsert';
  total: number;
  valid: number;
  inserted: number;
  updated: number;
  errors: ImportResultRow[];
}