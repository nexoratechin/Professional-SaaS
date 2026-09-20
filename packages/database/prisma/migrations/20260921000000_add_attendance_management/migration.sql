-- AddAttendanceManagement
-- Implements the complete attendance management module on top of the existing Student 360
-- attendance ledger (StudentAttendance stays the single physical record table) plus the
-- Timetable/Academics domain:
--  * a held class/day/period to be marked (AttendanceSession) anchored on term/courseOffering/
--    section/date with an optional timetable-entry snapshot; lifecycle OPEN -> CLOSED
--  * correction requests with an approval workflow (AttendanceCorrectionRequest); APPROVED
--    mutates the underlying student attendance row transactionally
--  * per-day staff/faculty attendance (FacultyAttendance), reusing the AttendanceStatus enum
--  * StudentAttendance gains sessionId (unique per student+session so bulk marking upserts),
--    markMethod (MANUAL/QR/BIOMETRIC capture channel) and signInAt (mark time for late logic)
-- Business rules (roster resolution, bulk marking, corrections, percentage/shortage/summary
-- reports, threshold enforcement) live in the API module and read configurable rules from the
-- tenant-configuration attendance section.

-- Enums --------------------------------------------------------------------------------------------------
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('OPEN','CLOSED');
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING','APPROVED','REJECTED');

-- Attendance sessions ------------------------------------------------------------------------------------
CREATE TABLE "attendance_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "term_id" UUID,
  "course_offering_id" UUID,
  "section_id" UUID,
  "timetable_entry_id" UUID,
  "date" TIMESTAMP(3) NOT NULL,
  "start_time" TEXT,
  "end_time" TEXT,
  "attendance_type" TEXT NOT NULL DEFAULT 'CLASS',
  "subject_code" TEXT,
  "subject_name" TEXT,
  "title" TEXT,
  "notes" TEXT,
  "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'OPEN',
  "marked_by_user_id" UUID,
  "created_by" UUID,
  "updated_by" UUID,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "closed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_sessions_tenant_id_idx" ON "attendance_sessions" ("tenant_id");
CREATE INDEX "attendance_sessions_tenant_id_date_idx" ON "attendance_sessions" ("tenant_id", "date");
CREATE INDEX "attendance_sessions_tenant_id_term_id_idx" ON "attendance_sessions" ("tenant_id", "term_id");
CREATE INDEX "attendance_sessions_tenant_id_course_offering_id_idx" ON "attendance_sessions" ("tenant_id", "course_offering_id");
CREATE INDEX "attendance_sessions_tenant_id_section_id_date_idx" ON "attendance_sessions" ("tenant_id", "section_id", "date");
CREATE INDEX "attendance_sessions_tenant_id_status_idx" ON "attendance_sessions" ("tenant_id", "status");
CREATE INDEX "attendance_sessions_tenant_id_timetable_entry_id_idx" ON "attendance_sessions" ("tenant_id", "timetable_entry_id");
CREATE INDEX "attendance_sessions_tenant_id_deleted_at_idx" ON "attendance_sessions" ("tenant_id", "deleted_at");

-- Correction requests ------------------------------------------------------------------------------------
CREATE TABLE "attendance_correction_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "session_id" UUID,
  "attendance_record_id" UUID,
  "from_status" "AttendanceStatus" NOT NULL,
  "to_status" "AttendanceStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "remarks" TEXT,
  "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by_user_id" UUID,
  "decided_by_user_id" UUID,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_correction_requests_tenant_id_idx" ON "attendance_correction_requests" ("tenant_id");
CREATE INDEX "attendance_correction_requests_tenant_id_status_idx" ON "attendance_correction_requests" ("tenant_id", "status");
CREATE INDEX "attendance_correction_requests_tenant_id_student_id_idx" ON "attendance_correction_requests" ("tenant_id", "student_id");
CREATE INDEX "attendance_correction_requests_tenant_id_session_id_idx" ON "attendance_correction_requests" ("tenant_id", "session_id");

-- Faculty/staff attendance -------------------------------------------------------------------------------
CREATE TABLE "faculty_attendance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "check_in_at" TIMESTAMP(3),
  "check_out_at" TIMESTAMP(3),
  "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "session_id" UUID,
  "mark_method" TEXT NOT NULL DEFAULT 'MANUAL',
  "remarks" TEXT,
  "marked_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "faculty_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "faculty_attendance_tenant_id_user_id_date_key" ON "faculty_attendance" ("tenant_id", "user_id", "date");
CREATE INDEX "faculty_attendance_tenant_id_idx" ON "faculty_attendance" ("tenant_id");
CREATE INDEX "faculty_attendance_tenant_id_user_id_idx" ON "faculty_attendance" ("tenant_id", "user_id");
CREATE INDEX "faculty_attendance_tenant_id_date_idx" ON "faculty_attendance" ("tenant_id", "date");

-- Student attendance ledger extensions -------------------------------------------------------------------
ALTER TABLE "student_attendance" ADD COLUMN "session_id" UUID;
ALTER TABLE "student_attendance" ADD COLUMN "mark_method" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "student_attendance" ADD COLUMN "sign_in_at" TIMESTAMP(3);

-- Foreign keys -------------------------------------------------------------------------------------------
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_timetable_entry_id_fkey" FOREIGN KEY ("timetable_entry_id") REFERENCES "timetable_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "faculty_attendance" ADD CONSTRAINT "faculty_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "faculty_attendance" ADD CONSTRAINT "faculty_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "faculty_attendance" ADD CONSTRAINT "faculty_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "student_attendance_tenant_id_session_id_student_id_key" ON "student_attendance" ("tenant_id", "session_id", "student_id");
CREATE INDEX "student_attendance_tenant_id_session_id_idx" ON "student_attendance" ("tenant_id", "session_id");