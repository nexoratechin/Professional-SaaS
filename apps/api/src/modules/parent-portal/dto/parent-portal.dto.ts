/**
 * Parent/Guardian Portal DTOs — the read-only self-service surface for a user linked to one or
 * more Guardian rows (Guardians.userId). Every child-scoped query carries an optional studentId;
 * the service resolves it against the caller's own linked children and rejects anything else, so
 * the query parameter is a *selector*, never a grant of access.
 */
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, IsString, Min } from 'class-validator';

/** Base for every child-scoped read. Omit studentId to use the caller's first linked child. */
export class ParentChildQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class ParentPaginationDto extends ParentChildQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}

export class ParentAttendanceQueryDto extends ParentPaginationDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'LEAVE'])
  status?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class ParentDocumentsQueryDto extends ParentPaginationDto {
  @IsOptional()
  @IsString()
  search?: string;
}

export class ParentNoticesQueryDto extends ParentChildQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}
