/**
 * Attendance device integrations DTOs — device registry CRUD, device↔person mappings, the
 * normalized device-event log list, pull-sync window and reconciliation filters. All validation
 * follows codebase conventions (class-validator, IsDateString for timestamps, IsIn for the
 * bounded option sets, Type(()=>Number) on query numerics).
 */
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DEVICE_LOG_STATUSES,
  DEVICE_MAPPING_TYPES,
  DEVICE_PROTOCOLS,
  DEVICE_STATUSES,
  DEVICE_TYPES,
  DEVICE_EVENT_TYPES,
} from './devices/device-constants';

export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(DEVICE_TYPES)
  deviceType: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(DEVICE_PROTOCOLS)
  protocol?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port?: number;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsString()
  authToken?: string;

  @IsOptional()
  @IsString()
  commKey?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(DEVICE_TYPES)
  deviceType?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(DEVICE_PROTOCOLS)
  protocol?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  port?: number;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string | null;

  @IsOptional()
  @IsIn(DEVICE_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  authToken?: string;

  @IsOptional()
  @IsString()
  commKey?: string;
}

export class ListDevicesQueryDto {
  @IsOptional()
  @IsIn(DEVICE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(DEVICE_TYPES)
  deviceType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  take?: number;
}

export class UpsertDeviceMappingDto {
  @IsString()
  @MinLength(1)
  externalPersonId: string;

  @IsIn(DEVICE_MAPPING_TYPES)
  mappedType: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListDeviceLogsQueryDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsIn(DEVICE_LOG_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  take?: number;
}

export class SyncDeviceDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ReconcileDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsBoolean()
  includeUnmapped?: boolean;
}

/** Strict-shape ingest for programmatic callers (admin UI / integrations). */
export class DeviceEventRowDto {
  @IsString()
  @MinLength(1)
  externalPersonId: string;

  @IsDateString()
  capturedAt: string;

  @IsIn(DEVICE_EVENT_TYPES)
  eventType: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class IngestEventsDto {
  @Type(() => DeviceEventRowDto)
  @ValidateNested({ each: true })
  @IsArray()
  events: DeviceEventRowDto[];
}