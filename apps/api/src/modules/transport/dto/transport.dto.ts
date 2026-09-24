/**
 * Transport module DTOs. Follows the hostel/exams/library convention: class-validator + Swagger,
 * stringly-typed enums validated with IsIn against exported constants (no native enum over the wire).
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// ── Closed taxonomies (mirror of the Prisma enums) ─────────────────────────

export const TRANSPORT_VEHICLE_TYPES = ['BUS', 'VAN', 'MINIBUS', 'CAR', 'OTHER'] as const;
export const TRANSPORT_VEHICLE_STATUSES = ['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SCRAPPED'] as const;
export const TRANSPORT_DOCUMENT_TYPES = [
  'REGISTRATION',
  'INSURANCE',
  'FITNESS',
  'PERMIT',
  'POLLUTION',
  'TAX_RECEIPT',
  'INSPECTION',
  'OTHER',
] as const;
export const TRANSPORT_DOCUMENT_STATUSES = ['VALID', 'EXPIRED', 'EXPIRING_SOON', 'REVOKED'] as const;
export const TRANSPORT_ROUTE_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const TRANSPORT_STOP_TYPES = ['PICKUP', 'DROP', 'PICKUP_AND_DROP'] as const;
export const TRANSPORT_DRIVER_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE'] as const;
export const TRANSPORT_TRIP_STATUSES = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export const TRANSPORT_MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION'] as const;
export const TRANSPORT_MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const TRANSPORT_ALERT_TYPES = [
  'SPEEDING',
  'OFF_ROUTE',
  'GEOFENCE_EXIT',
  'GEOFENCE_ENTER',
  'UNPLANNED_STOP',
  'ENGINE',
  'FUEL_LOW',
  'DELAYED',
  'MAINTENANCE_DUE',
  'DOCUMENT_EXPIRING',
  'OTHER',
] as const;
export const TRANSPORT_ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const TRANSPORT_PASS_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const;
export const TRANSPORT_GPS_PROVIDERS = ['mock'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class TransportPaginationDto {
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

// ── Vehicles ────────────────────────────────────────────────────────────────

export class ListVehiclesQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_VEHICLE_STATUSES)
  status?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateVehicleDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_VEHICLE_TYPES)
  type?: string;

  @IsString()
  @IsNotEmpty()
  registrationNumber: string;

  @IsOptional()
  @IsString()
  chassisNumber?: string;

  @IsOptional()
  @IsString()
  engineNumber?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  yearOfManufacture?: number;

  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seatingCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  standingCapacity?: number;

  @IsOptional()
  @IsBoolean()
  isAc?: boolean;

  @IsOptional()
  @IsString()
  gpsDeviceId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_VEHICLE_STATUSES)
  status?: string;
}

export class UpdateVehicleDto extends CreateVehicleDto {}

export class SetVehicleStatusDto {
  @IsIn(TRANSPORT_VEHICLE_STATUSES)
  status: string;
}

// ── Vehicle documents ───────────────────────────────────────────────────────

export class CreateVehicleDocumentDto {
  @IsIn(TRANSPORT_DOCUMENT_TYPES)
  documentType: string;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  issuer?: string;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  originalFilename?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsIn(TRANSPORT_DOCUMENT_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateVehicleDocumentDto extends CreateVehicleDocumentDto {}

// ── Drivers ─────────────────────────────────────────────────────────────────

export class ListDriversQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsIn(TRANSPORT_DRIVER_STATUSES)
  status?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateDriverDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @IsOptional()
  @IsString()
  licenseClass?: string;

  @IsOptional()
  @IsDateString()
  licenseExpiry?: string;

  @IsOptional()
  @IsString()
  profilePhotoKey?: string;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @IsOptional()
  @IsIn(TRANSPORT_DRIVER_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDriverDto extends CreateDriverDto {}

export class AssignDriverDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Routes & stops ──────────────────────────────────────────────────────────

export class ListRoutesQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_ROUTE_STATUSES)
  status?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @IsBoolean()
  includeStops?: boolean;
}

export class CreateRouteDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(TRANSPORT_ROUTE_STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distanceKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedDurationMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyFeeCents?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  vehicleId?: string;
}

export class UpdateRouteDto extends CreateRouteDto {}

export class CreateStopDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number;

  @IsOptional()
  @IsIn(TRANSPORT_STOP_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  pickupTime?: string;

  @IsOptional()
  @IsString()
  dropTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reachRadiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStopDto extends CreateStopDto {}

export class ReorderStopsDto {
  @IsArray()
  @IsString({ each: true })
  order: string[];
}

// ── Passes (student allocation) ─────────────────────────────────────────────

export class ListPassesQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_PASS_STATUSES)
  status?: string;
}

export class CreatePassDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  routeId: string;

  @IsString()
  @IsNotEmpty()
  stopId: string;

  @IsOptional()
  @IsString()
  dropStopId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsDateString()
  periodStart: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents?: number;

  /** Also write a StudentFee charge on the shared ledger for the pass period. */
  @IsOptional()
  @IsBoolean()
  chargeFee?: boolean;

  @IsOptional()
  @IsString()
  dailyPickupTime?: string;

  @IsOptional()
  @IsString()
  dailyDropTime?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdatePassDto extends CreatePassDto {}

export class SetPassStatusDto {
  @IsIn(TRANSPORT_PASS_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ChargePassDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthCount?: number;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  headCode?: string;

  @IsOptional()
  @IsString()
  headName?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class WaiveTransportChargeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Trips ───────────────────────────────────────────────────────────────────

export class ListTripsQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsIn(TRANSPORT_TRIP_STATUSES)
  status?: string;
}

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  routeId: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  scheduledDeparture?: string;

  @IsOptional()
  @IsDateString()
  scheduledArrival?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CancelTripDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class TripStopCheckpointDto {
  @IsOptional()
  @IsDateString()
  actualArrivalAt?: string;

  @IsOptional()
  @IsDateString()
  actualDepartureAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  studentsBoarded?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  studentsAlighted?: number;

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export class ListMaintenanceQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_MAINTENANCE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(TRANSPORT_MAINTENANCE_TYPES)
  type?: string;
}

export class CreateMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @IsIn(TRANSPORT_MAINTENANCE_TYPES)
  type: string;

  @IsOptional()
  @IsIn(TRANSPORT_MAINTENANCE_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometerKm?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  performedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateMaintenanceDto extends CreateMaintenanceDto {}

export class SetMaintenanceStatusDto {
  @IsIn(TRANSPORT_MAINTENANCE_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export class ListAlertsQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsIn(TRANSPORT_ALERT_SEVERITIES)
  severity?: string;

  @IsOptional()
  @IsIn(TRANSPORT_ALERT_TYPES)
  type?: string;

  @IsOptional()
  @IsBoolean()
  includeResolved?: boolean;
}

export class CreateAlertDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  tripId?: string;

  @IsIn(TRANSPORT_ALERT_TYPES)
  type: string;

  @IsIn(TRANSPORT_ALERT_SEVERITIES)
  severity: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  resolution?: string;
}

export class AcknowledgeAlertDto {
  @IsOptional()
  @IsString()
  note?: string;
}

// ── GPS config & ingest ─────────────────────────────────────────────────────

export class UpdateGpsConfigDto {
  @IsOptional()
  @IsIn(TRANSPORT_GPS_PROVIDERS)
  provider?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pollEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(3600)
  pollIntervalSeconds?: number;

  @IsOptional()
  settings?: Record<string, unknown>;
}

export class GpsPositionIngestDto {
  @IsString()
  @IsNotEmpty()
  vehicleDeviceId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GpsPositionDto)
  positions: GpsPositionDto[];
}

export class GpsPositionDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  speedKmh?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(359)
  heading?: number;

  @IsOptional()
  @IsNumber()
  accuracyMeters?: number;

  @ValidateIf(() => false)
  recordedAt?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class RouteLoadReportQueryDto {
  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}

export class VehicleUtilizationReportQueryDto {
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class DuesReportQueryDto extends TransportPaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}