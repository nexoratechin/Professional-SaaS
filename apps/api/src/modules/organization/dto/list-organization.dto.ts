import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ORGANIZATION_ENTITIES = [
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

export type OrganizationEntity = (typeof ORGANIZATION_ENTITIES)[number];

/** Shared list/pagination/filter query for every entity. Each entity interprets the
 * `q` free-text search and the parent-id filters it actually owns; unused ones are ignored. */
export class ListOrganizationDto {
  @IsOptional()
  @IsIn(ORGANIZATION_ENTITIES)
  entity?: OrganizationEntity;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;
}