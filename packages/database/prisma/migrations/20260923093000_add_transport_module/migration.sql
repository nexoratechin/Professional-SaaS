-- CreateEnum
CREATE TYPE "TransportVehicleType" AS ENUM ('BUS', 'VAN', 'MINIBUS', 'CAR', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportVehicleStatus" AS ENUM ('ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "TransportDocumentType" AS ENUM ('REGISTRATION', 'INSURANCE', 'FITNESS', 'PERMIT', 'POLLUTION', 'TAX_RECEIPT', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportDocumentStatus" AS ENUM ('VALID', 'EXPIRED', 'EXPIRING_SOON', 'REVOKED');

-- CreateEnum
CREATE TYPE "TransportRouteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TransportStopType" AS ENUM ('PICKUP', 'DROP', 'PICKUP_AND_DROP');

-- CreateEnum
CREATE TYPE "TransportDriverStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransportTripStatus" AS ENUM ('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportMaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION');

-- CreateEnum
CREATE TYPE "TransportMaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportAlertType" AS ENUM ('SPEEDING', 'OFF_ROUTE', 'GEOFENCE_EXIT', 'GEOFENCE_ENTER', 'UNPLANNED_STOP', 'ENGINE', 'FUEL_LOW', 'DELAYED', 'MAINTENANCE_DUE', 'DOCUMENT_EXPIRING', 'OTHER');

-- CreateEnum
CREATE TYPE "TransportAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "student_fees" ADD COLUMN     "transport_pass_id" UUID;

-- AlterTable
ALTER TABLE "student_transport_passes" ADD COLUMN     "daily_drop_time" TEXT,
ADD COLUMN     "daily_pickup_time" TEXT,
ADD COLUMN     "driver_id" UUID,
ADD COLUMN     "drop_stop_id" UUID,
ADD COLUMN     "issued_by_user_id" TEXT,
ADD COLUMN     "issued_on" TIMESTAMP(3),
ADD COLUMN     "route_id" UUID,
ADD COLUMN     "stop_id" UUID,
ADD COLUMN     "vehicle_id" UUID;

-- CreateTable
CREATE TABLE "transport_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "type" "TransportVehicleType" NOT NULL DEFAULT 'BUS',
    "registration_number" TEXT NOT NULL,
    "chassis_number" TEXT,
    "engine_number" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year_of_manufacture" INTEGER,
    "fuel_type" TEXT,
    "seating_capacity" INTEGER,
    "standing_capacity" INTEGER,
    "is_ac" BOOLEAN NOT NULL DEFAULT false,
    "gps_device_id" TEXT,
    "status" "TransportVehicleStatus" NOT NULL DEFAULT 'IN_SERVICE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_vehicle_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "document_type" "TransportDocumentType" NOT NULL,
    "document_number" TEXT,
    "issue_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "issuer" TEXT,
    "storage_key" TEXT,
    "original_filename" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "status" "TransportDocumentStatus" NOT NULL DEFAULT 'VALID',
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "alternate_phone" TEXT,
    "email" TEXT,
    "license_number" TEXT NOT NULL,
    "license_class" TEXT,
    "license_expiry" TIMESTAMP(3),
    "profile_photo_key" TEXT,
    "joined_at" TIMESTAMP(3),
    "status" "TransportDriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transport_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_driver_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TransportRouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "distance_km" DOUBLE PRECISION,
    "estimated_duration_min" INTEGER,
    "monthly_fee_cents" INTEGER,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "vehicle_id" UUID,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "TransportStopType" NOT NULL DEFAULT 'PICKUP',
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "pickup_time" TEXT,
    "drop_time" TEXT,
    "reach_radius_meters" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "transport_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_trips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "TransportTripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_departure" TIMESTAMP(3),
    "scheduled_arrival" TIMESTAMP(3),
    "actual_departure_at" TIMESTAMP(3),
    "actual_arrival_at" TIMESTAMP(3),
    "distance_km" DOUBLE PRECISION,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_trip_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "scheduled_time" TIMESTAMP(3),
    "actual_arrival_at" TIMESTAMP(3),
    "actual_departure_at" TIMESTAMP(3),
    "students_boarded" INTEGER NOT NULL DEFAULT 0,
    "students_alighted" INTEGER NOT NULL DEFAULT 0,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "transport_trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_maintenance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "TransportMaintenanceType" NOT NULL,
    "status" "TransportMaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_date" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "odometer_km" INTEGER,
    "description" TEXT,
    "vendor" TEXT,
    "cost_cents" INTEGER,
    "performed_by" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_gps_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "trip_id" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed_kmh" DOUBLE PRECISION,
    "heading" INTEGER,
    "accuracy_meters" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'mock',
    "raw_data" JSONB,

    CONSTRAINT "transport_gps_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "trip_id" UUID,
    "type" "TransportAlertType" NOT NULL,
    "severity" "TransportAlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "meta" JSONB,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_gps_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "poll_enabled" BOOLEAN NOT NULL DEFAULT false,
    "poll_interval_seconds" INTEGER NOT NULL DEFAULT 30,
    "settings" JSONB,
    "last_polled_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_gps_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transport_vehicles_tenant_id_idx" ON "transport_vehicles"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_vehicles_tenant_id_status_idx" ON "transport_vehicles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "transport_vehicles_tenant_id_deleted_at_idx" ON "transport_vehicles"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_vehicles_tenant_id_registration_number_key" ON "transport_vehicles"("tenant_id", "registration_number");

-- CreateIndex
CREATE INDEX "transport_vehicle_documents_tenant_id_idx" ON "transport_vehicle_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_vehicle_documents_tenant_id_vehicle_id_idx" ON "transport_vehicle_documents"("tenant_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "transport_vehicle_documents_tenant_id_document_type_status_idx" ON "transport_vehicle_documents"("tenant_id", "document_type", "status");

-- CreateIndex
CREATE INDEX "transport_drivers_tenant_id_idx" ON "transport_drivers"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_drivers_tenant_id_status_idx" ON "transport_drivers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "transport_drivers_tenant_id_deleted_at_idx" ON "transport_drivers"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_drivers_tenant_id_license_number_key" ON "transport_drivers"("tenant_id", "license_number");

-- CreateIndex
CREATE INDEX "transport_driver_assignments_tenant_id_idx" ON "transport_driver_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_driver_assignments_tenant_id_driver_id_is_active_idx" ON "transport_driver_assignments"("tenant_id", "driver_id", "is_active");

-- CreateIndex
CREATE INDEX "transport_driver_assignments_tenant_id_vehicle_id_is_active_idx" ON "transport_driver_assignments"("tenant_id", "vehicle_id", "is_active");

-- CreateIndex
CREATE INDEX "transport_routes_tenant_id_idx" ON "transport_routes"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_routes_tenant_id_status_idx" ON "transport_routes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "transport_routes_tenant_id_deleted_at_idx" ON "transport_routes"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_routes_tenant_id_code_key" ON "transport_routes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "transport_stops_tenant_id_idx" ON "transport_stops"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_stops_tenant_id_route_id_idx" ON "transport_stops"("tenant_id", "route_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_stops_tenant_id_route_id_order_key" ON "transport_stops"("tenant_id", "route_id", "order");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_idx" ON "transport_trips"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_route_id_date_idx" ON "transport_trips"("tenant_id", "route_id", "date");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_vehicle_id_date_idx" ON "transport_trips"("tenant_id", "vehicle_id", "date");

-- CreateIndex
CREATE INDEX "transport_trips_tenant_id_status_idx" ON "transport_trips"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transport_trips_tenant_id_route_id_date_key" ON "transport_trips"("tenant_id", "route_id", "date");

-- CreateIndex
CREATE INDEX "transport_trip_stops_tenant_id_idx" ON "transport_trip_stops"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_trip_stops_tenant_id_trip_id_idx" ON "transport_trip_stops"("tenant_id", "trip_id");

-- CreateIndex
CREATE INDEX "transport_maintenance_records_tenant_id_idx" ON "transport_maintenance_records"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_maintenance_records_tenant_id_vehicle_id_idx" ON "transport_maintenance_records"("tenant_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "transport_maintenance_records_tenant_id_status_idx" ON "transport_maintenance_records"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "transport_gps_positions_tenant_id_idx" ON "transport_gps_positions"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_gps_positions_tenant_id_vehicle_id_recorded_at_idx" ON "transport_gps_positions"("tenant_id", "vehicle_id", "recorded_at");

-- CreateIndex
CREATE INDEX "transport_gps_positions_tenant_id_trip_id_recorded_at_idx" ON "transport_gps_positions"("tenant_id", "trip_id", "recorded_at");

-- CreateIndex
CREATE INDEX "transport_alerts_tenant_id_idx" ON "transport_alerts"("tenant_id");

-- CreateIndex
CREATE INDEX "transport_alerts_tenant_id_severity_resolved_at_idx" ON "transport_alerts"("tenant_id", "severity", "resolved_at");

-- CreateIndex
CREATE INDEX "transport_alerts_tenant_id_vehicle_id_created_at_idx" ON "transport_alerts"("tenant_id", "vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "transport_alerts_tenant_id_trip_id_idx" ON "transport_alerts"("tenant_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_gps_configs_tenant_id_key" ON "transport_gps_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "student_transport_passes_tenant_id_route_id_idx" ON "student_transport_passes"("tenant_id", "route_id");

-- CreateIndex
CREATE INDEX "student_transport_passes_tenant_id_vehicle_id_idx" ON "student_transport_passes"("tenant_id", "vehicle_id");

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_transport_pass_id_fkey" FOREIGN KEY ("transport_pass_id") REFERENCES "student_transport_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "transport_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_drop_stop_id_fkey" FOREIGN KEY ("drop_stop_id") REFERENCES "transport_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "transport_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicle_documents" ADD CONSTRAINT "transport_vehicle_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicle_documents" ADD CONSTRAINT "transport_vehicle_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_drivers" ADD CONSTRAINT "transport_drivers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_drivers" ADD CONSTRAINT "transport_drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_driver_assignments" ADD CONSTRAINT "transport_driver_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_driver_assignments" ADD CONSTRAINT "transport_driver_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "transport_drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_driver_assignments" ADD CONSTRAINT "transport_driver_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trips" ADD CONSTRAINT "transport_trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "transport_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_stops" ADD CONSTRAINT "transport_trip_stops_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_stops" ADD CONSTRAINT "transport_trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "transport_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_trip_stops" ADD CONSTRAINT "transport_trip_stops_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "transport_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_maintenance_records" ADD CONSTRAINT "transport_maintenance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_maintenance_records" ADD CONSTRAINT "transport_maintenance_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_gps_positions" ADD CONSTRAINT "transport_gps_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_gps_positions" ADD CONSTRAINT "transport_gps_positions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_gps_positions" ADD CONSTRAINT "transport_gps_positions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_alerts" ADD CONSTRAINT "transport_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_alerts" ADD CONSTRAINT "transport_alerts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_alerts" ADD CONSTRAINT "transport_alerts_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "transport_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_gps_configs" ADD CONSTRAINT "transport_gps_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

