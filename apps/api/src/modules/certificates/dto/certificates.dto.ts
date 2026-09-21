/**
 * Certificates DTOs. Follows the results/exams convention: class-validator + Swagger, stringly-typed
 * closed taxonomies (validated with `IsIn`), template/field config passed as free-form JSON so the
 * tenant stack stays config-compatible (the same JSON a template stores is what a request sends).
 */
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsJSON, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export const CERTIFICATE_TYPES = [
  'BONAFIDE',
  'PROVISIONAL',
  'MIGRATION',
  'TRANSCRIPT',
  'TRANSFER_CERTIFICATE',
  'GRADE_CARD',
  'MARKSHEET',
  'CHARACTER_CERTIFICATE',
  'TESTIMONIAL',
  'OTHER',
] as const;

export const CERTIFICATE_STATUSES = ['REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED', 'REVOKED'] as const;

export class CertificatesPaginationDto {
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

  @IsOptional()
  @IsString()
  search?: string;
}

// ── Templates ───────────────────────────────────────────────────────────────

export class CreateCertificateTemplateDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(CERTIFICATE_TYPES)
  certificateType!: string;

  /** Ordered `label → source` map; supports `student.x`, `program.x`, `campus.x`, `batch.x`,
   * `certificate.x` paths and the `subjects` / `summary` block tokens. */
  @IsOptional()
  @IsObject()
  fieldConfig?: Record<string, string>;

  /** Branding overrides: `{ collegeName?, tagline?, headerText?, footerText?, watermark?, signedBy?,
   * primaryColor?, accentColor? }`. Omitted keys inherit from tenant configuration branding. */
  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  /** Numbering chain: `{ prefix?, start?, padding? }`. */
  @IsOptional()
  @IsObject()
  numbering?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  qrEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCertificateTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsObject()
  fieldConfig?: Record<string, string>;

  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  numbering?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  qrEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTemplatesQueryDto {
  @IsOptional()
  @IsIn(CERTIFICATE_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

// ── Certificates ────────────────────────────────────────────────────────────

export class RequestCertificateDto {
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @IsIn(CERTIFICATE_TYPES)
  certificateType!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class GenerateCertificateDto {
  /** Optional; falls back to the type's default (isDefault) template. */
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class RejectCertificateDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class RevokeCertificateDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ReissueCertificateDto {
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListCertificatesQueryDto {
  @IsOptional()
  @IsIn(CERTIFICATE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(CERTIFICATE_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

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

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsJSON()
  filter?: string;
}