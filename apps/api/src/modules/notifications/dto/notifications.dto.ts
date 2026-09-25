/**
 * Notifications module DTOs — templates, campaigns, provider configs, event triggers,
 * preferences and push devices. Follows the helpdesk/inventory convention: class-validator +
 * Swagger, stringly-typed enum values validated with IsIn against exported constants that mirror
 * the Prisma enums over the wire.
 */
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
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { NOTIFICATION_CHANNELS } from '@college-erp/notifications';

// ── Closed taxonomies (mirrors of the Prisma enums) ─────────────────────────

export const NOTIFICATION_CHANNEL_OPTIONS = [...NOTIFICATION_CHANNELS] as const;

export const NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES = ['ALL', 'ROLES', 'DEPARTMENTS', 'CAMPUSES', 'BATCHES', 'STUDENTS', 'USERS'] as const;

/** Provider names per channel the worker recognizes — mirrors PROVIDERS_BY_CHANNEL in
 * @college-erp/notifications. Validated here so a tenant can never save a config the worker
 * would refuse to instantiate. */
export const NOTIFICATION_PROVIDERS_BY_CHANNEL: Record<(typeof NOTIFICATION_CHANNEL_OPTIONS)[number], readonly string[]> = {
  EMAIL: ['smtp', 'console'],
  SMS: ['http', 'console'],
  WHATSAPP: ['http', 'console'],
  PUSH: ['http', 'console'],
  IN_APP: ['in_app'],
};

export function notificationProvidersFor(channel: string): readonly string[] {
  return NOTIFICATION_PROVIDERS_BY_CHANNEL[channel as keyof typeof NOTIFICATION_PROVIDERS_BY_CHANNEL] ?? [];
}

// ── Templates ────────────────────────────────────────────────────────────────

export class CreateNotificationTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(NOTIFICATION_CHANNEL_OPTIONS)
  channel!: (typeof NOTIFICATION_CHANNEL_OPTIONS)[number];

  @IsString()
  @IsNotEmpty()
  subjectTemplate!: string;

  @IsString()
  @IsNotEmpty()
  bodyTemplate!: string;

  /** Informational variable declarations: [{key, description, required}]. */
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_CHANNEL_OPTIONS)
  channel?: (typeof NOTIFICATION_CHANNEL_OPTIONS)[number];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subjectTemplate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bodyTemplate?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export class CreateNotificationCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUUID()
  templateId!: string;

  /** Audience definition resolved by @college-erp/notifications' resolveAudience. */
  @IsObject()
  audienceFilter!: unknown;

  /** ISO-8601; null = launch immediately when `launch` is called. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateNotificationCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsObject()
  audienceFilter?: unknown;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;
}

export class CampaignAudiencePreviewDto {
  @IsIn(NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES)
  type!: (typeof NOTIFICATION_CAMPAIGN_AUDIENCE_TYPES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  departmentIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  campusIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  batchIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  userIds?: string[];
}

// ── Provider configs ─────────────────────────────────────────────────────────

export class CreateNotificationProviderConfigDto {
  @IsIn(NOTIFICATION_CHANNEL_OPTIONS)
  channel!: (typeof NOTIFICATION_CHANNEL_OPTIONS)[number];

  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Non-secret settings (host/port/from/url/headers/body template...). */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /** Secret credential bag — encrypted at rest with NOTIFICATION_SECRET_KEY, never returned. */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateNotificationProviderConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// ── Event triggers ───────────────────────────────────────────────────────────

export class CreateNotificationEventTriggerDto {
  /** Free-form event key emitted by a domain module (e.g. `helpdesk.ticket.created`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  eventKey!: string;

  @IsUUID()
  templateId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Preferences / push devices ───────────────────────────────────────────────

export class UpdateNotificationPreferenceDto {
  @IsIn(NOTIFICATION_CHANNEL_OPTIONS)
  channel!: (typeof NOTIFICATION_CHANNEL_OPTIONS)[number];

  @IsBoolean()
  enabled!: boolean;
}

export class RegisterPushDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  deviceToken!: string;

  @IsIn(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';
}

// ── Shared pagination ────────────────────────────────────────────────────────

export class NotificationsPaginationDto {
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