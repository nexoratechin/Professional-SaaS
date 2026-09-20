-- AddAttendanceDevices
-- Advanced attendance integrations: device registry, device<->person mappings and the raw
-- normalized event log feeding the ingest/reconciliation pipeline (QR / biometric / RFID /
-- API). Vendor-neutral on purpose: device_type/vendor/protocol are free-form strings and every
-- vendor publishes into the same AttendanceDeviceLog pipeline; wire protocols slot in as
-- registered adapters. Device secrets (push token, comm key) are AES-256-GCM encrypted at rest.

-- Attendance device registry -----------------------------------------------------------------------------
CREATE TABLE "attendance_devices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "device_type" TEXT NOT NULL,
  "vendor" TEXT NOT NULL DEFAULT 'Generic',
  "model" TEXT,
  "protocol" TEXT NOT NULL DEFAULT 'HTTP_PUSH',
  "ip_address" TEXT,
  "port" INTEGER,
  "endpoint_url" TEXT,
  "serial_number" TEXT,
  "location" TEXT,
  "room_id" UUID,
  "auth_token_encrypted" TEXT,
  "comm_key_encrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "last_seen_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "last_sync_status" TEXT,
  "last_sync_message" TEXT,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_devices_tenant_id_code_key" ON "attendance_devices" ("tenant_id", "code");
CREATE INDEX "attendance_devices_tenant_id_idx" ON "attendance_devices" ("tenant_id");
CREATE INDEX "attendance_devices_tenant_id_status_idx" ON "attendance_devices" ("tenant_id", "status");
CREATE INDEX "attendance_devices_tenant_id_device_type_idx" ON "attendance_devices" ("tenant_id", "device_type");
CREATE INDEX "attendance_devices_tenant_id_deleted_at_idx" ON "attendance_devices" ("tenant_id", "deleted_at");

-- Device <-> person mappings ------------------------------------------------------------------------------
CREATE TABLE "attendance_device_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "external_person_id" TEXT NOT NULL,
  "mapped_type" TEXT NOT NULL,
  "student_id" UUID,
  "user_id" UUID,
  "label" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_device_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_device_users_tenant_id_device_id_external_person_id_key" ON "attendance_device_users" ("tenant_id", "device_id", "external_person_id");
CREATE UNIQUE INDEX "attendance_device_users_tenant_id_device_id_student_id_key" ON "attendance_device_users" ("tenant_id", "device_id", "student_id");
CREATE UNIQUE INDEX "attendance_device_users_tenant_id_device_id_user_id_key" ON "attendance_device_users" ("tenant_id", "device_id", "user_id");
CREATE INDEX "attendance_device_users_tenant_id_idx" ON "attendance_device_users" ("tenant_id");
CREATE INDEX "attendance_device_users_tenant_id_student_id_idx" ON "attendance_device_users" ("tenant_id", "student_id");
CREATE INDEX "attendance_device_users_tenant_id_user_id_idx" ON "attendance_device_users" ("tenant_id", "user_id");

-- Raw normalized device events (single ingest + reconciliation pipeline) ---------------------------------------
CREATE TABLE "attendance_device_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "external_person_id" TEXT,
  "student_id" UUID,
  "user_id" UUID,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ingest_source" TEXT NOT NULL DEFAULT 'API',
  "dedupe_key" TEXT,
  "raw_payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "processing_note" TEXT,
  "session_id" UUID,
  "applied_record_id" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_device_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_device_logs_tenant_id_dedupe_key_key" ON "attendance_device_logs" ("tenant_id", "dedupe_key");
CREATE INDEX "attendance_device_logs_tenant_id_idx" ON "attendance_device_logs" ("tenant_id");
CREATE INDEX "attendance_device_logs_tenant_id_device_id_idx" ON "attendance_device_logs" ("tenant_id", "device_id");
CREATE INDEX "attendance_device_logs_tenant_id_status_idx" ON "attendance_device_logs" ("tenant_id", "status");
CREATE INDEX "attendance_device_logs_tenant_id_captured_at_idx" ON "attendance_device_logs" ("tenant_id", "captured_at");
CREATE INDEX "attendance_device_logs_tenant_id_session_id_idx" ON "attendance_device_logs" ("tenant_id", "session_id");

-- Foreign keys --------------------------------------------------------------------------------------------
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_device_users" ADD CONSTRAINT "attendance_device_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_users" ADD CONSTRAINT "attendance_device_users_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_device_users" ADD CONSTRAINT "attendance_device_users_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_device_users" ADD CONSTRAINT "attendance_device_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_device_logs" ADD CONSTRAINT "attendance_device_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_logs" ADD CONSTRAINT "attendance_device_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_device_logs" ADD CONSTRAINT "attendance_device_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_device_logs" ADD CONSTRAINT "attendance_device_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_device_logs" ADD CONSTRAINT "attendance_device_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;