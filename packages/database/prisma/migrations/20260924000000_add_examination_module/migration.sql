-- CreateEnum
CREATE TYPE "ExamSessionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamSubjectStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExamRegistrationStatus" AS ENUM ('REGISTERED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamHallTicketStatus" AS ENUM ('PENDING', 'ISSUED');

-- CreateEnum
CREATE TYPE "ExamSeatAllocationStatus" AS ENUM ('ALLOCATED', 'PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "ExamInvigilatorRole" AS ENUM ('CHIEF_INVIGILATOR', 'INVIGILATOR');

-- CreateEnum
CREATE TYPE "ExamEligibilityRuleType" AS ENUM ('ACTIVE_STUDENT', 'PROGRAM_ENROLLMENT', 'MINIMUM_ATTENDANCE', 'CLEARED_PREREQUISITES', 'OPEN_BACKLOG');

-- CreateEnum
CREATE TYPE "ExamMarksStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MODERATED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ExamRevaluationStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');

-- AlterTable
ALTER TABLE "student_exams" ADD COLUMN     "session_id" UUID;

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "program_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID,
    "exam_type" "ExamType" NOT NULL,
    "is_supplementary" BOOLEAN NOT NULL DEFAULT false,
    "base_session_id" UUID,
    "status" "ExamSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "result_declaration_date" TIMESTAMP(3),
    "eligibility_policy" TEXT,
    "result_published_at" TIMESTAMP(3),
    "result_published_by" UUID,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "room_id" UUID,
    "max_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "duration_minutes" INTEGER,
    "pattern" TEXT,
    "exam_date" TIMESTAMP(3),
    "start_time" TEXT,
    "end_time" TEXT,
    "status" "ExamSubjectStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_eligibility_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "rule_type" "ExamEligibilityRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_attendance_percent" INTEGER,
    "remarks" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_eligibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "ExamRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_hall_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "status" "ExamHallTicketStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMP(3),
    "issued_by" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_hall_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_hall_ticket_subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hall_ticket_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "max_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "exam_date" TIMESTAMP(3),
    "start_time" TEXT,
    "end_time" TEXT,
    "room_name" TEXT,
    "seat_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_hall_ticket_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_seating_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "subject_id" UUID,
    "room_id" UUID NOT NULL,
    "label" TEXT,
    "capacity" INTEGER,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_seating_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_seat_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "seat_no" TEXT NOT NULL,
    "status" "ExamSeatAllocationStatus" NOT NULL DEFAULT 'ALLOCATED',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_seat_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_invigilator_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ExamInvigilatorRole" NOT NULL DEFAULT 'INVIGILATOR',
    "room_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_invigilator_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_marks_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "marks_obtained" INTEGER,
    "grace_marks" INTEGER NOT NULL DEFAULT 0,
    "attendance_status" TEXT NOT NULL DEFAULT 'PRESENT',
    "status" "ExamMarksStatus" NOT NULL DEFAULT 'DRAFT',
    "moderated_by" TEXT,
    "moderated_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "remark" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_marks_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_revaluation_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "marks_entry_id" UUID,
    "reason" TEXT NOT NULL,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExamRevaluationStatus" NOT NULL DEFAULT 'REQUESTED',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "revised_marks" INTEGER,
    "remark" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_revaluation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_sessions_tenant_id_idx" ON "exam_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_sessions_tenant_id_program_id_term_id_idx" ON "exam_sessions"("tenant_id", "program_id", "term_id");

-- CreateIndex
CREATE INDEX "exam_sessions_tenant_id_status_idx" ON "exam_sessions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "exam_sessions_tenant_id_deleted_at_idx" ON "exam_sessions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_tenant_id_code_key" ON "exam_sessions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_idx" ON "exam_subjects"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_session_id_idx" ON "exam_subjects"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "exam_subjects_tenant_id_status_idx" ON "exam_subjects"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_tenant_id_session_id_course_id_key" ON "exam_subjects"("tenant_id", "session_id", "course_id");

-- CreateIndex
CREATE INDEX "exam_eligibility_rules_tenant_id_session_id_idx" ON "exam_eligibility_rules"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_eligibility_rules_tenant_id_session_id_rule_type_key" ON "exam_eligibility_rules"("tenant_id", "session_id", "rule_type");

-- CreateIndex
CREATE INDEX "exam_registrations_tenant_id_idx" ON "exam_registrations"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_registrations_tenant_id_student_id_idx" ON "exam_registrations"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "exam_registrations_tenant_id_session_id_idx" ON "exam_registrations"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_registrations_tenant_id_session_id_student_id_key" ON "exam_registrations"("tenant_id", "session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_hall_tickets_registration_id_key" ON "exam_hall_tickets"("registration_id");

-- CreateIndex
CREATE INDEX "exam_hall_tickets_tenant_id_idx" ON "exam_hall_tickets"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_hall_tickets_tenant_id_session_id_idx" ON "exam_hall_tickets"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "exam_hall_tickets_tenant_id_status_idx" ON "exam_hall_tickets"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_hall_tickets_tenant_id_ticket_number_key" ON "exam_hall_tickets"("tenant_id", "ticket_number");

-- CreateIndex
CREATE INDEX "exam_hall_ticket_subjects_tenant_id_idx" ON "exam_hall_ticket_subjects"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_hall_ticket_subjects_tenant_id_hall_ticket_id_idx" ON "exam_hall_ticket_subjects"("tenant_id", "hall_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_hall_ticket_subjects_tenant_id_hall_ticket_id_subject__key" ON "exam_hall_ticket_subjects"("tenant_id", "hall_ticket_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_seating_plans_tenant_id_idx" ON "exam_seating_plans"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_seating_plans_tenant_id_session_id_idx" ON "exam_seating_plans"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "exam_seating_plans_tenant_id_subject_id_idx" ON "exam_seating_plans"("tenant_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_seat_allocations_tenant_id_idx" ON "exam_seat_allocations"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_seat_allocations_tenant_id_student_id_idx" ON "exam_seat_allocations"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "exam_seat_allocations_tenant_id_plan_id_idx" ON "exam_seat_allocations"("tenant_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_seat_allocations_tenant_id_plan_id_registration_id_key" ON "exam_seat_allocations"("tenant_id", "plan_id", "registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_seat_allocations_tenant_id_plan_id_seat_no_key" ON "exam_seat_allocations"("tenant_id", "plan_id", "seat_no");

-- CreateIndex
CREATE INDEX "exam_invigilator_assignments_tenant_id_idx" ON "exam_invigilator_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_invigilator_assignments_tenant_id_user_id_idx" ON "exam_invigilator_assignments"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "exam_invigilator_assignments_tenant_id_subject_id_idx" ON "exam_invigilator_assignments"("tenant_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_invigilator_assignments_tenant_id_subject_id_user_id_key" ON "exam_invigilator_assignments"("tenant_id", "subject_id", "user_id");

-- CreateIndex
CREATE INDEX "exam_marks_entries_tenant_id_idx" ON "exam_marks_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_marks_entries_tenant_id_subject_id_idx" ON "exam_marks_entries"("tenant_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_marks_entries_tenant_id_status_idx" ON "exam_marks_entries"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_marks_entries_tenant_id_registration_id_subject_id_key" ON "exam_marks_entries"("tenant_id", "registration_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_revaluation_requests_tenant_id_idx" ON "exam_revaluation_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_revaluation_requests_tenant_id_status_idx" ON "exam_revaluation_requests"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_revaluation_requests_tenant_id_registration_id_subject_key" ON "exam_revaluation_requests"("tenant_id", "registration_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exams_tenant_id_student_id_session_id_key" ON "student_exams"("tenant_id", "student_id", "session_id");

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_base_session_id_fkey" FOREIGN KEY ("base_session_id") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_eligibility_rules" ADD CONSTRAINT "exam_eligibility_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_eligibility_rules" ADD CONSTRAINT "exam_eligibility_rules_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_registrations" ADD CONSTRAINT "exam_registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_tickets" ADD CONSTRAINT "exam_hall_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_tickets" ADD CONSTRAINT "exam_hall_tickets_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_tickets" ADD CONSTRAINT "exam_hall_tickets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_ticket_subjects" ADD CONSTRAINT "exam_hall_ticket_subjects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_ticket_subjects" ADD CONSTRAINT "exam_hall_ticket_subjects_hall_ticket_id_fkey" FOREIGN KEY ("hall_ticket_id") REFERENCES "exam_hall_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_hall_ticket_subjects" ADD CONSTRAINT "exam_hall_ticket_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seating_plans" ADD CONSTRAINT "exam_seating_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seating_plans" ADD CONSTRAINT "exam_seating_plans_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seating_plans" ADD CONSTRAINT "exam_seating_plans_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seating_plans" ADD CONSTRAINT "exam_seating_plans_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seat_allocations" ADD CONSTRAINT "exam_seat_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seat_allocations" ADD CONSTRAINT "exam_seat_allocations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "exam_seating_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seat_allocations" ADD CONSTRAINT "exam_seat_allocations_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_seat_allocations" ADD CONSTRAINT "exam_seat_allocations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilator_assignments" ADD CONSTRAINT "exam_invigilator_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilator_assignments" ADD CONSTRAINT "exam_invigilator_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilator_assignments" ADD CONSTRAINT "exam_invigilator_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilator_assignments" ADD CONSTRAINT "exam_invigilator_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks_entries" ADD CONSTRAINT "exam_marks_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks_entries" ADD CONSTRAINT "exam_marks_entries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks_entries" ADD CONSTRAINT "exam_marks_entries_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks_entries" ADD CONSTRAINT "exam_marks_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_revaluation_requests" ADD CONSTRAINT "exam_revaluation_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_revaluation_requests" ADD CONSTRAINT "exam_revaluation_requests_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_revaluation_requests" ADD CONSTRAINT "exam_revaluation_requests_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_revaluation_requests" ADD CONSTRAINT "exam_revaluation_requests_marks_entry_id_fkey" FOREIGN KEY ("marks_entry_id") REFERENCES "exam_marks_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

