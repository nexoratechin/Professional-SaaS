-- Student 360 module: enums, tables, indexes, foreign keys
-- Generated schema matches packages/database/prisma/schema.prisma

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('APPLICANT', 'ADMITTED', 'PROVISIONAL', 'ENROLLED', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'ALUMNI');

-- CreateEnum
CREATE TYPE "StudentGender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GuardianKind" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "GuardianRole" AS ENUM ('PRIMARY', 'SECONDARY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "StudentDocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('APPLIED', 'DOCUMENTS_VERIFIED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN', 'ON_HOLD', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'LEAVE');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('MID_TERM', 'END_TERM', 'UNIT_TEST', 'PRACTICAL', 'VIVA', 'ANNUAL', 'SUPPLEMENTARY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResultOutcome" AS ENUM ('PASS', 'FAIL', 'PASS_WITH_GRACE', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('BONAFIDE', 'PROVISIONAL', 'MIGRATION', 'TRANSCRIPT', 'TRANSFER_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LibraryLoanStatus" AS ENUM ('ISSUED', 'RETURNED', 'OVERDUE', 'LOST');

-- CreateEnum
CREATE TYPE "HostelBookingStatus" AS ENUM ('REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransportPassStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StudentHoldType" AS ENUM ('ACADEMIC', 'FINANCIAL', 'ADMINISTRATIVE', 'DISCIPLINARY', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentHoldStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'LETTER', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "user_id" UUID,
    "admission_number" TEXT NOT NULL,
    "roll_number" TEXT,
    "registration_number" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" "StudentGender" NOT NULL DEFAULT 'NOT_SPECIFIED',
    "blood_group" "BloodGroup" NOT NULL DEFAULT 'UNKNOWN',
    "date_of_birth" TIMESTAMP(3),
    "nationality" TEXT DEFAULT 'Indian',
    "category" TEXT,
    "email" TEXT,
    "alternate_email" TEXT,
    "primary_phone" TEXT,
    "alternate_phone" TEXT,
    "current_address_line_1" TEXT,
    "current_address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT DEFAULT 'India',
    "permanent_address_line_1" TEXT,
    "permanent_address_line_2" TEXT,
    "permanent_city" TEXT,
    "permanent_state" TEXT,
    "permanent_postal_code" TEXT,
    "permanent_country" TEXT DEFAULT 'India',
    "profile_photo_key" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'APPLICANT',
    "program_id" UUID,
    "batch_id" UUID,
    "section_id" UUID,
    "academic_year_id" UUID,
    "admitted_on" TIMESTAMP(3),
    "year_of_admission" INTEGER,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "GuardianKind" NOT NULL,
    "role" "GuardianRole" NOT NULL DEFAULT 'PRIMARY',
    "phone" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "monthly_income_cents" INTEGER,
    "address" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "storage_key" TEXT,
    "original_filename" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "status" "StudentDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "remarks" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_admissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "application_number" TEXT NOT NULL,
    "program_id" UUID NOT NULL,
    "academic_year_id" UUID,
    "applied_at" TIMESTAMP(3) NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'APPLIED',
    "mode" TEXT,
    "offer_letter_key" TEXT,
    "admission_fee_cents" INTEGER,
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_academic_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "board" TEXT,
    "degree" TEXT,
    "year_of_passing" INTEGER,
    "percentage" DOUBLE PRECISION,
    "gpa" DOUBLE PRECISION,
    "grade" TEXT,
    "marks_obtained" INTEGER,
    "marks_out_of" INTEGER,
    "rank" TEXT,
    "is_highest_qualification" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "StudentDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_academic_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID,
    "program_id" UUID NOT NULL,
    "section_id" UUID,
    "batch_id" UUID,
    "roll_number" TEXT,
    "semester" INTEGER,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "attendance_type" TEXT NOT NULL DEFAULT 'CLASS',
    "term_id" UUID,
    "subject_code" TEXT,
    "subject_name" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "marked_by_user_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "term_id" UUID,
    "head_code" TEXT NOT NULL,
    "head_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "waived_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "FeeStatus" NOT NULL DEFAULT 'ISSUED',
    "due_date" TIMESTAMP(3),
    "remarks" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "student_fee_id" UUID,
    "receipt_number" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_date" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "reference_number" TEXT,
    "recorded_by_user_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_exams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "exam_type" "ExamType" NOT NULL,
    "term_id" UUID,
    "program_id" UUID,
    "section_id" UUID,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" "ExamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_id" UUID,
    "subject_code" TEXT NOT NULL,
    "subject_name" TEXT NOT NULL,
    "max_marks" INTEGER NOT NULL,
    "obtained_marks" INTEGER,
    "grade" TEXT,
    "percentage" DOUBLE PRECISION,
    "outcome" "ResultOutcome" NOT NULL DEFAULT 'INCOMPLETE',
    "published_at" TIMESTAMP(3),
    "published_by" UUID,
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "certificate_type" "CertificateType" NOT NULL,
    "certificate_number" TEXT,
    "title" TEXT,
    "request_date" TIMESTAMP(3) NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'REQUESTED',
    "generated_at" TIMESTAMP(3),
    "generated_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "issued_at" TIMESTAMP(3),
    "issued_by_user_id" UUID,
    "storage_key" TEXT,
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_library_loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "item_title" TEXT NOT NULL,
    "item_author" TEXT,
    "item_code" TEXT,
    "item_type" TEXT,
    "borrowed_at" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "status" "LibraryLoanStatus" NOT NULL DEFAULT 'ISSUED',
    "fine_cents" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_library_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_hostel_bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "hostel_name" TEXT NOT NULL,
    "room_number" TEXT NOT NULL,
    "bed_number" TEXT,
    "allocation_date" TIMESTAMP(3),
    "check_in_date" TIMESTAMP(3),
    "check_out_date" TIMESTAMP(3),
    "status" "HostelBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "monthly_rent_cents" INTEGER,
    "remarks" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_hostel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_transport_passes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "route_code" TEXT,
    "route_name" TEXT NOT NULL,
    "pickup_point" TEXT,
    "drop_point" TEXT,
    "vehicle_number" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3),
    "status" "TransportPassStatus" NOT NULL DEFAULT 'ACTIVE',
    "amount_cents" INTEGER,
    "remarks" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_transport_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "StudentHoldType" NOT NULL,
    "reason" TEXT NOT NULL,
    "placed_on" TIMESTAMP(3) NOT NULL,
    "placed_by_user_id" UUID,
    "status" "StudentHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "lifted_on" TIMESTAMP(3),
    "lifted_by_user_id" UUID,
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_status" "StudentStatus",
    "to_status" "StudentStatus" NOT NULL,
    "reason" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_communications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "recipient_type" TEXT NOT NULL DEFAULT 'STUDENT',
    "recipient_name" TEXT,
    "recipient_phone" TEXT,
    "recipient_email" TEXT,
    "conducted_by_user_id" UUID,
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "students_tenant_id_idx" ON "students"("tenant_id");

-- CreateIndex
CREATE INDEX "students_tenant_id_deleted_at_idx" ON "students"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "students_campus_id_idx" ON "students"("campus_id");

-- CreateIndex
CREATE INDEX "students_program_id_idx" ON "students"("program_id");

-- CreateIndex
CREATE INDEX "students_batch_id_idx" ON "students"("batch_id");

-- CreateIndex
CREATE INDEX "students_section_id_idx" ON "students"("section_id");

-- CreateIndex
CREATE INDEX "students_tenant_id_status_idx" ON "students"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenant_id_admission_number_key" ON "students"("tenant_id", "admission_number");

-- CreateIndex
CREATE INDEX "guardians_tenant_id_idx" ON "guardians"("tenant_id");

-- CreateIndex
CREATE INDEX "guardians_student_id_idx" ON "guardians"("student_id");

-- CreateIndex
CREATE INDEX "student_documents_tenant_id_idx" ON "student_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "student_documents_student_id_idx" ON "student_documents"("student_id");

-- CreateIndex
CREATE INDEX "student_documents_tenant_id_status_idx" ON "student_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_admissions_tenant_id_idx" ON "student_admissions"("tenant_id");

-- CreateIndex
CREATE INDEX "student_admissions_student_id_idx" ON "student_admissions"("student_id");

-- CreateIndex
CREATE INDEX "student_admissions_program_id_idx" ON "student_admissions"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_admissions_tenant_id_application_number_key" ON "student_admissions"("tenant_id", "application_number");

-- CreateIndex
CREATE INDEX "student_academic_records_tenant_id_idx" ON "student_academic_records"("tenant_id");

-- CreateIndex
CREATE INDEX "student_academic_records_student_id_idx" ON "student_academic_records"("student_id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_idx" ON "student_enrollments"("tenant_id");

-- CreateIndex
CREATE INDEX "student_enrollments_student_id_idx" ON "student_enrollments"("student_id");

-- CreateIndex
CREATE INDEX "student_enrollments_academic_year_id_idx" ON "student_enrollments"("academic_year_id");

-- CreateIndex
CREATE INDEX "student_enrollments_tenant_id_status_idx" ON "student_enrollments"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_tenant_id_student_id_academic_year_id_program_id_key" ON "student_enrollments"("tenant_id", "student_id", "academic_year_id", "program_id");

-- CreateIndex
CREATE INDEX "student_attendance_tenant_id_idx" ON "student_attendance"("tenant_id");

-- CreateIndex
CREATE INDEX "student_attendance_student_id_idx" ON "student_attendance"("student_id");

-- CreateIndex
CREATE INDEX "student_attendance_student_id_date_idx" ON "student_attendance"("student_id", "date");

-- CreateIndex
CREATE INDEX "student_attendance_tenant_id_status_idx" ON "student_attendance"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_fees_tenant_id_idx" ON "student_fees"("tenant_id");

-- CreateIndex
CREATE INDEX "student_fees_student_id_idx" ON "student_fees"("student_id");

-- CreateIndex
CREATE INDEX "student_fees_tenant_id_status_idx" ON "student_fees"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_fees_student_id_status_idx" ON "student_fees"("student_id", "status");

-- CreateIndex
CREATE INDEX "student_payments_tenant_id_idx" ON "student_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "student_payments_student_id_idx" ON "student_payments"("student_id");

-- CreateIndex
CREATE INDEX "student_payments_student_fee_id_idx" ON "student_payments"("student_fee_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_payments_tenant_id_receipt_number_key" ON "student_payments"("tenant_id", "receipt_number");

-- CreateIndex
CREATE INDEX "student_exams_tenant_id_idx" ON "student_exams"("tenant_id");

-- CreateIndex
CREATE INDEX "student_exams_student_id_idx" ON "student_exams"("student_id");

-- CreateIndex
CREATE INDEX "student_exams_program_id_idx" ON "student_exams"("program_id");

-- CreateIndex
CREATE INDEX "student_results_tenant_id_idx" ON "student_results"("tenant_id");

-- CreateIndex
CREATE INDEX "student_results_student_id_idx" ON "student_results"("student_id");

-- CreateIndex
CREATE INDEX "student_results_exam_id_idx" ON "student_results"("exam_id");

-- CreateIndex
CREATE INDEX "student_certificates_tenant_id_idx" ON "student_certificates"("tenant_id");

-- CreateIndex
CREATE INDEX "student_certificates_student_id_idx" ON "student_certificates"("student_id");

-- CreateIndex
CREATE INDEX "student_certificates_tenant_id_status_idx" ON "student_certificates"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_certificates_tenant_id_certificate_number_key" ON "student_certificates"("tenant_id", "certificate_number");

-- CreateIndex
CREATE INDEX "student_library_loans_tenant_id_idx" ON "student_library_loans"("tenant_id");

-- CreateIndex
CREATE INDEX "student_library_loans_student_id_idx" ON "student_library_loans"("student_id");

-- CreateIndex
CREATE INDEX "student_library_loans_tenant_id_status_idx" ON "student_library_loans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_tenant_id_idx" ON "student_hostel_bookings"("tenant_id");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_student_id_idx" ON "student_hostel_bookings"("student_id");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_tenant_id_status_idx" ON "student_hostel_bookings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_transport_passes_tenant_id_idx" ON "student_transport_passes"("tenant_id");

-- CreateIndex
CREATE INDEX "student_transport_passes_student_id_idx" ON "student_transport_passes"("student_id");

-- CreateIndex
CREATE INDEX "student_transport_passes_tenant_id_status_idx" ON "student_transport_passes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_holds_tenant_id_idx" ON "student_holds"("tenant_id");

-- CreateIndex
CREATE INDEX "student_holds_student_id_idx" ON "student_holds"("student_id");

-- CreateIndex
CREATE INDEX "student_holds_tenant_id_status_idx" ON "student_holds"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_status_history_tenant_id_idx" ON "student_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "student_status_history_student_id_idx" ON "student_status_history"("student_id");

-- CreateIndex
CREATE INDEX "student_status_history_student_id_changed_at_idx" ON "student_status_history"("student_id", "changed_at");

-- CreateIndex
CREATE INDEX "student_communications_tenant_id_idx" ON "student_communications"("tenant_id");

-- CreateIndex
CREATE INDEX "student_communications_student_id_idx" ON "student_communications"("student_id");

-- CreateIndex
CREATE INDEX "student_communications_student_id_sent_at_idx" ON "student_communications"("student_id", "sent_at");

-- CreateIndex
CREATE INDEX "student_activities_tenant_id_idx" ON "student_activities"("tenant_id");

-- CreateIndex
CREATE INDEX "student_activities_student_id_idx" ON "student_activities"("student_id");

-- CreateIndex
CREATE INDEX "student_activities_student_id_occurred_at_idx" ON "student_activities"("student_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_admissions" ADD CONSTRAINT "student_admissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_admissions" ADD CONSTRAINT "student_admissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_admissions" ADD CONSTRAINT "student_admissions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_admissions" ADD CONSTRAINT "student_admissions_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_academic_records" ADD CONSTRAINT "student_academic_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_academic_records" ADD CONSTRAINT "student_academic_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_student_fee_id_fkey" FOREIGN KEY ("student_fee_id") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exams" ADD CONSTRAINT "student_exams_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_results" ADD CONSTRAINT "student_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_results" ADD CONSTRAINT "student_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_results" ADD CONSTRAINT "student_results_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "student_exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_certificates" ADD CONSTRAINT "student_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_certificates" ADD CONSTRAINT "student_certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_library_loans" ADD CONSTRAINT "student_library_loans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_library_loans" ADD CONSTRAINT "student_library_loans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_transport_passes" ADD CONSTRAINT "student_transport_passes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_holds" ADD CONSTRAINT "student_holds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_holds" ADD CONSTRAINT "student_holds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_communications" ADD CONSTRAINT "student_communications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_communications" ADD CONSTRAINT "student_communications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_activities" ADD CONSTRAINT "student_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_activities" ADD CONSTRAINT "student_activities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;