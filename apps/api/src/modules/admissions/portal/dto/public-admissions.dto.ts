import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PHONE = /^[+0-9][0-9\s-]{7,20}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class PortalOtpRequestDto {
  @IsIn(['EMAIL', 'PHONE'])
  channel: 'EMAIL' | 'PHONE';

  @IsString()
  @Length(3, 320)
  contact: string;
}

export class PortalOtpVerifyDto extends PortalOtpRequestDto {
  @IsString()
  @Length(4, 10)
  code: string;
}

export class PortalResumeDto {
  @IsString()
  @Length(20, 200)
  resumeToken: string;
}

export class PortalGuardianDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(40) relationship?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @Matches(PHONE) @MaxLength(24) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) occupation?: string;
}

/** Everything an applicant supplies to open a draft. Programme + session are explicit; campus and
 * academic year are derived server-side from the session (an applicant cannot pick another
 * campus's intake). */
export class CreatePortalApplicationDto {
  @IsString()
  @Length(1, 36)
  publicSlug: string;

  @IsString()
  @Length(1, 36)
  programOfferId: string;

  @IsString()
  @Length(1, 80)
  firstName: string;

  @IsOptional() @IsString() @MaxLength(80) middleName?: string;

  @IsString()
  @Length(1, 80)
  lastName: string;

  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED']) gender?: string;

  @IsOptional() @Matches(DATE_ONLY) dateOfBirth?: string;

  @IsOptional() @IsEmail() @MaxLength(320) email?: string;

  @IsOptional() @Matches(PHONE) @MaxLength(24) phone?: string;

  @IsOptional() @IsString() @MaxLength(64) category?: string;

  @IsOptional() @IsString() @MaxLength(64) nationality?: string;

  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;

  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;

  @IsOptional() @IsString() @MaxLength(80) city?: string;

  @IsOptional() @IsString() @MaxLength(80) state?: string;

  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;

  @IsOptional() @IsString() @MaxLength(80) country?: string;

  @IsOptional() @ValidateNested() @Type(() => PortalGuardianDto) guardian?: PortalGuardianDto;

  /** Answers to the configurable form, keyed by field code. */
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

/** Partial update of a draft. Status is never client-controlled. */
export class UpdatePortalApplicationDto {
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED']) gender?: string;
  @IsOptional() @Matches(DATE_ONLY) dateOfBirth?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @Matches(PHONE) @MaxLength(24) phone?: string;
  @IsOptional() @IsString() @MaxLength(64) category?: string;
  @IsOptional() @IsString() @MaxLength(64) nationality?: string;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) middleName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @ValidateNested() @Type(() => PortalGuardianDto) guardian?: PortalGuardianDto;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

export class PortalQualificationDto {
  @IsString() @Length(1, 200) institution: string;
  @IsOptional() @IsString() @MaxLength(120) board?: string;
  @IsOptional() @IsString() @MaxLength(120) degree?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) yearOfPassing?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) percentage?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10) gpa?: number;
  @IsOptional() @IsString() @MaxLength(40) grade?: string;
  @IsOptional() @IsInt() @Min(0) marksObtained?: number;
  @IsOptional() @IsInt() @Min(1) marksOutOf?: number;
  @IsOptional() @IsString() @MaxLength(40) rank?: string;
  @IsOptional() @IsBoolean() isHighestQualification?: boolean;
}

export class PortalUploadUrlDto {
  @IsString() @Length(1, 64) category: string;
  @IsString() @Length(1, 255) filename: string;
  @IsString() @Length(3, 120) contentType: string;
  @IsInt() @Min(1) sizeBytes: number;
}

export class PortalConfirmUploadDto {
  @IsOptional() @IsInt() @Min(1) sizeBytes?: number;
}

export class PortalSubmitDto {
  @IsString() @Length(1, 32) consentVersion: string;

  @IsBoolean()
  declarationAccepted: boolean;
}

export class PortalOfferResponseDto {
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class UpdateSessionPortalDto {
  @IsBoolean() portalEnabled: boolean;

  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/)
  publicSlug?: string;

  @IsOptional() @IsString() @MaxLength(40) portalOpenAt?: string;
  @IsOptional() @IsString() @MaxLength(40) portalCloseAt?: string;

  @IsOptional() @IsObject() portalInstructions?: Record<string, unknown>;
}
