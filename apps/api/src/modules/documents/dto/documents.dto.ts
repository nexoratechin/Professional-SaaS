import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Lifecycle states a document can be filtered by (mirrors DocumentStatus minus transient/pending
 *  states — the full enum is exposed on the resource DTO, but list filters are narrow/stable). */
export const DOCUMENT_LIST_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'AWAITING_SCAN',
  'READY',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'QUARANTINED',
] as const;

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(DOCUMENT_LIST_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentTypeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

/** POST /documents/upload-url. Backward compatible with the original shape (filename, mimeType,
 *  category) used by helpdesk; the extended fields (documentTypeId, title, description, metadata,
 *  tags, expiresAt) power the centralized document management flow. */
export class RequestUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  /** Storage-key partition (legacy consumers pass e.g. `helpdesk`). When a documentTypeId is
   *  given and category is omitted, the type's code is used. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentTypeId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Only honored when the document's type allows expiry (canExpire). */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UploadVersionDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** Only honored when the document's type allows expiry (canExpire). */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  expiresAtCleared?: boolean;
}

export class VerifyDocumentDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class GrantDocumentAccessDto {
  @IsIn(['USER', 'ROLE'])
  granteeType!: 'USER' | 'ROLE';

  /** Exactly one of granteeUserId / granteeRoleId must be set, matching granteeType. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  granteeUserId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  granteeRoleId?: string;

  @IsOptional()
  @IsBoolean()
  canView?: boolean;

  @IsOptional()
  @IsBoolean()
  canDownload?: boolean;
}

export class CreateDocumentTypeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** MIME types allowed for upload (null = inherit the global allowlist). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedMimeTypes?: string[];

  /** File extensions allowed (no leading dot; null = any extension). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedExtensions?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxSizeBytes?: number;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsBoolean()
  canExpire?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  retentionDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDocumentTypeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedMimeTypes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedExtensions?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxSizeBytes?: number;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @IsBoolean()
  canExpire?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  retentionDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}