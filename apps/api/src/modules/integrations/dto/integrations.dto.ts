import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_STATUSES,
  WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS,
} from '@college-erp/integrations';
// Prisma's generated enum OBJECTS rather than duplicated string arrays: validating a filter against the
// same enum the schema declares means the accepted values can never drift from what Postgres will
// take, and a typo becomes a 400 instead of a 500 from the driver.
import {
  IntegrationFailureCategory,
  IntegrationOperationStatus,
  IntegrationSyncRunStatus,
  IntegrationWebhookEventStatus,
} from '@college-erp/database';

export class CreateIntegrationDto {
  /**
   * Tenant-unique stable handle used in URLs and job payloads. Restricted to a slug because it
   * becomes a path segment; the display name is free-form and never used for addressing.
   */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, {
    message: 'key must be a lowercase slug of 3-64 characters (letters, digits, hyphens)',
  })
  key: string;

  @IsString()
  @Length(1, 120)
  name: string;

  @IsEnum(INTEGRATION_CATEGORIES)
  category: (typeof INTEGRATION_CATEGORIES)[number];

  /**
   * Adapter key. Validated against the registry rather than a fixed enum, because a host app may
   * have registered a bespoke adapter at boot — that is the entire point of the registry.
   */
  @IsString()
  @Length(1, 64)
  provider: string;

  @IsOptional()
  @IsEnum(['OUTBOUND', 'INBOUND', 'BIDIRECTIONAL'])
  direction?: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  /** Non-secret settings. Validated field-by-field by assertValidIntegrationConfig. */
  @IsObject()
  config: Record<string, unknown>;

  /**
   * Secret values. Stored encrypted; never returned by any endpoint. Omitted on update means
   * "leave the existing credentials alone" — a settings form that only edits a timeout must not
   * blank out the tenant's gateway API key.
   */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  retryPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  retryPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /**
   * Category and provider are intentionally NOT updatable. Changing the provider of a live
   * integration would silently reinterpret every stored idempotency key, webhook signature and
   * sync cursor under a different wire protocol; the operator must create a new integration instead.
   */
}

export class ChangeIntegrationStatusDto {
  @IsEnum(INTEGRATION_STATUSES)
  status: (typeof INTEGRATION_STATUSES)[number];
}

export class CreateWebhookEndpointDto {
  @IsString()
  @Length(1, 120)
  name: string;

  /** Provider event names this endpoint accepts. Omit/empty = accept every event type. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eventTypes?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 128)
  signatureHeader?: string;

  @IsOptional()
  @IsEnum(WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS)
  signatureAlgorithm?: (typeof WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS)[number];

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86_400)
  signatureToleranceSecs?: number;
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  eventTypes?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 128)
  signatureHeader?: string;

  @IsOptional()
  @IsEnum(WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS)
  signatureAlgorithm?: (typeof WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS)[number];

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(86_400)
  signatureToleranceSecs?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DispatchOperationDto {
  /** Logical operation name, e.g. `payment.create`, `student.push`. */
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, {
    message: 'operation must be a dotted lowercase name like "payment.create"',
  })
  operation: string;

  @IsObject()
  payload: Record<string, unknown>;

  /**
   * Caller-supplied idempotency key. Supplying one is what makes a retry after an ambiguous
   * timeout safe; omitting it lets the framework generate a key that is stable only for the retries
   * of this single dispatch.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;

  /**
   * Run inline instead of via the queue. Only honoured for synchronous, fast operations — the
   * default is queued so a slow provider cannot hold an HTTP request open.
   */
  @IsOptional()
  @IsBoolean()
  synchronous?: boolean;
}

export class StartSyncRunDto {
  /** Logical entity type to sync, e.g. `student`, `fee_invoice`. Validated against the category's capabilities. */
  @IsString()
  @Length(1, 64)
  entityType: string;

  @IsOptional()
  @IsEnum(['PULL_SYNC', 'PUSH_SYNC'])
  mode?: 'PULL_SYNC' | 'PUSH_SYNC';

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize?: number;
}

export class ResolveFailureDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  resolved?: boolean;
}

export class IntegrationPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class IntegrationFilterDto extends IntegrationPaginationDto {
  @IsOptional()
  @IsEnum(INTEGRATION_CATEGORIES)
  category?: (typeof INTEGRATION_CATEGORIES)[number];

  @IsOptional()
  @IsEnum(INTEGRATION_STATUSES)
  status?: (typeof INTEGRATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  search?: string;
}

export class WebhookEventFilterDto extends IntegrationPaginationDto {
  @IsOptional()
  @IsEnum(IntegrationWebhookEventStatus)
  status?: keyof typeof IntegrationWebhookEventStatus;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  eventType?: string;

  @IsOptional()
  @IsUUID()
  integrationId?: string;
}

export class FailureFilterDto extends IntegrationPaginationDto {
  @IsOptional()
  @IsEnum(IntegrationFailureCategory)
  category?: keyof typeof IntegrationFailureCategory;

  @IsOptional()
  @IsUUID()
  integrationId?: string;

  /** 'true' = only triaged, 'false' = only open. A string because query params are strings; an unset
   *  or unrecognised value means "no filter" rather than an error. */
  @IsOptional()
  @IsString()
  resolved?: string;
}

export class SyncRunFilterDto extends IntegrationPaginationDto {
  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @IsOptional()
  @IsEnum(IntegrationSyncRunStatus)
  status?: keyof typeof IntegrationSyncRunStatus;
}

/** Outbound operation log filter. */
export class OperationFilterDto extends IntegrationPaginationDto {
  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @IsOptional()
  @IsEnum(IntegrationOperationStatus)
  status?: keyof typeof IntegrationOperationStatus;
}
