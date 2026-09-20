-- Admissions lifecycle module: enums, tables, indexes, foreign keys
-- Generated schema matches packages/database/prisma/schema.prisma

-- CreateEnum
CREATE TYPE "AdmissionSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AdmissionProgramStatus" AS ENUM ('OPEN', 'CLOSED', 'FULL');

-- CreateEnum
CREATE TYPE "AdmissionApplicationStatus" AS ENUM ('INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED', 'MERIT_LISTED', 'COUNSELLING_SCHEDULED', 'COUNSELLED', 'SELECTED', 'OFFERED', 'OFFER_ACCEPTED', 'FEE_PAID', 'ENROLLED', 'WAITLISTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionOfferStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "admission_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "application_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "admission_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "AdmissionSessionStatus" NOT NULL DEFAULT 'OPEN',
    "required_documents" JSONB,
    "source" TEXT DEFAULT 'FRONT_DESK',
    "merit_published_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_program_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "filled_seats" INTEGER NOT NULL DEFAULT 0,
    "application_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "admission_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "tuition_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "required_documents" JSONB,
    "status" "AdmissionProgramStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_program_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_enquiries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID,
    "program_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "message" TEXT,
    "follow_up_at" TIMESTAMP(3),
    "converted_to_application_id" UUID,
    "converted_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_number" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "admission_program_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "enquiry_id" UUID,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" "StudentGender" NOT NULL DEFAULT 'NOT_SPECIFIED',
    "date_of_birth" TIMESTAMP(3),
    "email" TEXT,
    "phone" TEXT,
    "category" TEXT,
    "nationality" TEXT DEFAULT 'Indian',
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT DEFAULT 'India',
    "guardian" JSONB,
    "data" JSONB,
    "remarks" TEXT,
    "status" "AdmissionApplicationStatus" NOT NULL DEFAULT 'INITIATED',
    "submitted_at" TIMESTAMP(3),
    "submitted_by" UUID,
    "rejected_reason" TEXT,
    "merit_score" DOUBLE PRECISION,
    "merit_rank" INTEGER,
    "counselling_slot_id" UUID,
    "counselled_at" TIMESTAMP(3),
    "selected_at" TIMESTAMP(3),
    "fee_paid_at" TIMESTAMP(3),
    "fee_receipt_number" TEXT,
    "enrolled_student_id" UUID,
    "enrolled_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
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

    CONSTRAINT "admission_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_qualifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
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

    CONSTRAINT "admission_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_counselling_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "program_id" UUID,
    "date" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_counselling_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "offer_number" TEXT NOT NULL,
    "admission_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "AdmissionOfferStatus" NOT NULL DEFAULT 'ISSUED',
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_fee_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_date" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "reference_number" TEXT,
    "receipt_number" TEXT NOT NULL,
    "remarks" TEXT,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_sessions_tenant_id_code_key" ON "admission_sessions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "admission_sessions_tenant_id_idx" ON "admission_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_sessions_tenant_id_status_idx" ON "admission_sessions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "admission_sessions_academic_year_id_idx" ON "admission_sessions"("academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_program_offers_tenant_id_session_id_program_id_key" ON "admission_program_offers"("tenant_id", "session_id", "program_id");

-- CreateIndex
CREATE INDEX "admission_program_offers_tenant_id_idx" ON "admission_program_offers"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_program_offers_session_id_idx" ON "admission_program_offers"("session_id");

-- CreateIndex
CREATE INDEX "admission_program_offers_program_id_idx" ON "admission_program_offers"("program_id");

-- CreateIndex
CREATE INDEX "admission_enquiries_tenant_id_idx" ON "admission_enquiries"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_enquiries_session_id_idx" ON "admission_enquiries"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenant_id_application_number_key" ON "admission_applications"("tenant_id", "application_number");

-- CreateIndex
CREATE INDEX "admission_applications_tenant_id_idx" ON "admission_applications"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_applications_tenant_id_status_idx" ON "admission_applications"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "admission_applications_session_id_idx" ON "admission_applications"("session_id");

-- CreateIndex
CREATE INDEX "admission_applications_admission_program_id_idx" ON "admission_applications"("admission_program_id");

-- CreateIndex
CREATE INDEX "admission_applications_campus_id_idx" ON "admission_applications"("campus_id");

-- CreateIndex
CREATE INDEX "admission_applications_academic_year_id_idx" ON "admission_applications"("academic_year_id");

-- CreateIndex
CREATE INDEX "admission_applications_merit_score_idx" ON "admission_applications"("merit_score");

-- CreateIndex
CREATE INDEX "admission_documents_tenant_id_idx" ON "admission_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_documents_application_id_idx" ON "admission_documents"("application_id");

-- CreateIndex
CREATE INDEX "admission_documents_tenant_id_status_idx" ON "admission_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "admission_qualifications_tenant_id_idx" ON "admission_qualifications"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_qualifications_application_id_idx" ON "admission_qualifications"("application_id");

-- CreateIndex
CREATE INDEX "admission_counselling_slots_tenant_id_idx" ON "admission_counselling_slots"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_counselling_slots_session_id_idx" ON "admission_counselling_slots"("session_id");

-- CreateIndex
CREATE INDEX "admission_counselling_slots_program_id_idx" ON "admission_counselling_slots"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_tenant_id_offer_number_key" ON "admission_offers"("tenant_id", "offer_number");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_tenant_id_application_id_key" ON "admission_offers"("tenant_id", "application_id");

-- CreateIndex
CREATE INDEX "admission_offers_tenant_id_idx" ON "admission_offers"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_offers_tenant_id_status_idx" ON "admission_offers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "admission_offers_application_id_idx" ON "admission_offers"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_fee_payments_tenant_id_receipt_number_key" ON "admission_fee_payments"("tenant_id", "receipt_number");

-- CreateIndex
CREATE INDEX "admission_fee_payments_tenant_id_idx" ON "admission_fee_payments"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_fee_payments_application_id_idx" ON "admission_fee_payments"("application_id");

-- CreateIndex
CREATE INDEX "admission_activities_tenant_id_idx" ON "admission_activities"("tenant_id");

-- CreateIndex
CREATE INDEX "admission_activities_application_id_idx" ON "admission_activities"("application_id");

-- CreateIndex
CREATE INDEX "admission_activities_application_id_occurred_at_idx" ON "admission_activities"("application_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "admission_sessions" ADD CONSTRAINT "admission_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_sessions" ADD CONSTRAINT "admission_sessions_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_program_offers" ADD CONSTRAINT "admission_program_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_program_offers" ADD CONSTRAINT "admission_program_offers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "admission_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_program_offers" ADD CONSTRAINT "admission_program_offers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_enquiries" ADD CONSTRAINT "admission_enquiries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_enquiries" ADD CONSTRAINT "admission_enquiries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "admission_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_enquiries" ADD CONSTRAINT "admission_enquiries_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "admission_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_admission_program_id_fkey" FOREIGN KEY ("admission_program_id") REFERENCES "admission_program_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "admission_enquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_counselling_slot_id_fkey" FOREIGN KEY ("counselling_slot_id") REFERENCES "admission_counselling_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_enrolled_student_id_fkey" FOREIGN KEY ("enrolled_student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_documents" ADD CONSTRAINT "admission_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_documents" ADD CONSTRAINT "admission_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_qualifications" ADD CONSTRAINT "admission_qualifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_qualifications" ADD CONSTRAINT "admission_qualifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_counselling_slots" ADD CONSTRAINT "admission_counselling_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_counselling_slots" ADD CONSTRAINT "admission_counselling_slots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "admission_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_counselling_slots" ADD CONSTRAINT "admission_counselling_slots_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_fee_payments" ADD CONSTRAINT "admission_fee_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_fee_payments" ADD CONSTRAINT "admission_fee_payments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_activities" ADD CONSTRAINT "admission_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_activities" ADD CONSTRAINT "admission_activities_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;