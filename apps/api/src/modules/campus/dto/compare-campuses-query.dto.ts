import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Accepts `campusIds=a,b` and `campusIds=a&campusIds=b` alike. */
function normalizeCampusIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = raw
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Query for GET /campuses/compare?campusIds=… (repeatable or comma-separated). */
export class CompareCampusesQueryDto {
  @ApiPropertyOptional({
    description: 'Campus ids to compare — repeat the parameter or comma-separate them.',
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeCampusIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  campusIds?: string[];
}