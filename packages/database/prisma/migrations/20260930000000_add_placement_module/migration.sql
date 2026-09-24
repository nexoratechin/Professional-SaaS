-- CreateEnum
CREATE TYPE "PlacementCompanyType" AS ENUM ('MNC', 'INDIAN_MNC', 'STARTUP', 'PSU', 'CORPORATE', 'SME', 'GOVT_ORG', 'NGO', 'OTHER');

-- CreateEnum
CREATE TYPE "PlacementDriveMode" AS ENUM ('ON_CAMPUS', 'OFF_CAMPUS', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "PlacementDriveStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlacementPositionType" AS ENUM ('FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'TRAINEE');

-- CreateEnum
CREATE TYPE "PlacementEligibilityStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'EXEMPTED');

-- CreateEnum
CREATE TYPE "PlacementApplicationStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PlacementRoundType" AS ENUM ('APTITUDE_TEST', 'TECHNICAL_TEST', 'PSYCHOMETRIC_TEST', 'GROUP_DISCUSSION', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW', 'MANAGERIAL_INTERVIEW', 'CASE_STUDY', 'OTHER');

-- CreateEnum
CREATE TYPE "PlacementRoundStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlacementRoundResultStatus" AS ENUM ('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD', 'ABSENT');

-- CreateEnum
CREATE TYPE "PlacementOfferStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PlacementJoiningStatus" AS ENUM ('PENDING', 'JOINED', 'NOT_JOINED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "PlacementOutcomeStatus" AS ENUM ('PLACED', 'NOT_PLACED', 'OPTED_OUT', 'UNREGISTERED');

-- CreateTable
CREATE TABLE "placement_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_type" "PlacementCompanyType" NOT NULL DEFAULT 'OTHER',
    "industry" TEXT,
    "website" TEXT,
    "description" TEXT,
    "headquarters_city" TEXT,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'India',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_drives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" "PlacementDriveMode" NOT NULL DEFAULT 'ON_CAMPUS',
    "status" "PlacementDriveStatus" NOT NULL DEFAULT 'DRAFT',
    "drive_date" TIMESTAMP(3),
    "application_deadline" TIMESTAMP(3),
    "venue" TEXT,
    "coordinator_contact_id" UUID,
    "eligibility_notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_drives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position_type" "PlacementPositionType" NOT NULL DEFAULT 'FULL_TIME',
    "location" TEXT,
    "openings" INTEGER DEFAULT 1,
    "description" TEXT,
    "min_cgpa" DOUBLE PRECISION,
    "min_percentage" DOUBLE PRECISION,
    "max_backlogs" INTEGER,
    "package_cents" INTEGER,
    "package_notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_eligibility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "PlacementEligibilityStatus" NOT NULL DEFAULT 'PENDING',
    "criteria_snapshot" JSONB,
    "student_snapshot" JSONB,
    "remarks" TEXT,
    "evaluated_by_user_id" UUID,
    "evaluated_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_eligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_resumes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_user_id" UUID,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "resume_id" UUID,
    "status" "PlacementApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shortlisted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "round_type" "PlacementRoundType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "location_or_link" TEXT,
    "status" "PlacementRoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_round_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "result" "PlacementRoundResultStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "assessed_by_user_id" UUID,
    "assessed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_round_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "selected_by_user_id" UUID,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "selection_id" UUID,
    "student_id" UUID NOT NULL,
    "offer_letter_number" TEXT NOT NULL,
    "package_cents" INTEGER,
    "joining_location" TEXT,
    "status" "PlacementOfferStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "placement_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_joinings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "drive_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "expected_joining_date" TIMESTAMP(3),
    "actual_joining_date" TIMESTAMP(3),
    "joining_location" TEXT,
    "status" "PlacementJoiningStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_joinings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_outcomes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "drive_id" UUID,
    "position_id" UUID,
    "offer_id" UUID,
    "outcome_status" "PlacementOutcomeStatus" NOT NULL DEFAULT 'UNREGISTERED',
    "final_package_cents" INTEGER,
    "placed_at" TIMESTAMP(3),
    "declared_by_user_id" UUID,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placement_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "placement_companies_tenant_id_idx" ON "placement_companies"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_companies_tenant_id_deleted_at_idx" ON "placement_companies"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "placement_companies_tenant_id_code_key" ON "placement_companies"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "placement_contacts_tenant_id_idx" ON "placement_contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_contacts_company_id_idx" ON "placement_contacts"("company_id");

-- CreateIndex
CREATE INDEX "placement_contacts_tenant_id_deleted_at_idx" ON "placement_contacts"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "placement_drives_tenant_id_idx" ON "placement_drives"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_drives_company_id_idx" ON "placement_drives"("company_id");

-- CreateIndex
CREATE INDEX "placement_drives_tenant_id_status_idx" ON "placement_drives"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "placement_drives_tenant_id_deleted_at_idx" ON "placement_drives"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "placement_drives_tenant_id_code_key" ON "placement_drives"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "placement_positions_tenant_id_idx" ON "placement_positions"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_positions_drive_id_idx" ON "placement_positions"("drive_id");

-- CreateIndex
CREATE INDEX "placement_positions_tenant_id_deleted_at_idx" ON "placement_positions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "placement_eligibility_tenant_id_idx" ON "placement_eligibility"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_eligibility_student_id_idx" ON "placement_eligibility"("student_id");

-- CreateIndex
CREATE INDEX "placement_eligibility_drive_id_idx" ON "placement_eligibility"("drive_id");

-- CreateIndex
CREATE INDEX "placement_eligibility_position_id_idx" ON "placement_eligibility"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_eligibility_tenant_id_drive_id_position_id_studen_key" ON "placement_eligibility"("tenant_id", "drive_id", "position_id", "student_id");

-- CreateIndex
CREATE INDEX "placement_resumes_tenant_id_idx" ON "placement_resumes"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_resumes_student_id_idx" ON "placement_resumes"("student_id");

-- CreateIndex
CREATE INDEX "placement_resumes_tenant_id_deleted_at_idx" ON "placement_resumes"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "placement_applications_tenant_id_idx" ON "placement_applications"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_applications_drive_id_idx" ON "placement_applications"("drive_id");

-- CreateIndex
CREATE INDEX "placement_applications_position_id_idx" ON "placement_applications"("position_id");

-- CreateIndex
CREATE INDEX "placement_applications_student_id_idx" ON "placement_applications"("student_id");

-- CreateIndex
CREATE INDEX "placement_applications_tenant_id_status_idx" ON "placement_applications"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "placement_applications_tenant_id_drive_id_position_id_stude_key" ON "placement_applications"("tenant_id", "drive_id", "position_id", "student_id");

-- CreateIndex
CREATE INDEX "placement_rounds_tenant_id_idx" ON "placement_rounds"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_rounds_drive_id_idx" ON "placement_rounds"("drive_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_rounds_tenant_id_drive_id_sequence_key" ON "placement_rounds"("tenant_id", "drive_id", "sequence");

-- CreateIndex
CREATE INDEX "placement_round_results_tenant_id_idx" ON "placement_round_results"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_round_results_round_id_idx" ON "placement_round_results"("round_id");

-- CreateIndex
CREATE INDEX "placement_round_results_application_id_idx" ON "placement_round_results"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_round_results_tenant_id_round_id_application_id_key" ON "placement_round_results"("tenant_id", "round_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_selections_application_id_key" ON "placement_selections"("application_id");

-- CreateIndex
CREATE INDEX "placement_selections_tenant_id_idx" ON "placement_selections"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_selections_drive_id_idx" ON "placement_selections"("drive_id");

-- CreateIndex
CREATE INDEX "placement_selections_position_id_idx" ON "placement_selections"("position_id");

-- CreateIndex
CREATE INDEX "placement_selections_student_id_idx" ON "placement_selections"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_selections_tenant_id_application_id_key" ON "placement_selections"("tenant_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_offers_application_id_key" ON "placement_offers"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_offers_selection_id_key" ON "placement_offers"("selection_id");

-- CreateIndex
CREATE INDEX "placement_offers_tenant_id_idx" ON "placement_offers"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_offers_drive_id_idx" ON "placement_offers"("drive_id");

-- CreateIndex
CREATE INDEX "placement_offers_position_id_idx" ON "placement_offers"("position_id");

-- CreateIndex
CREATE INDEX "placement_offers_student_id_idx" ON "placement_offers"("student_id");

-- CreateIndex
CREATE INDEX "placement_offers_tenant_id_status_idx" ON "placement_offers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "placement_offers_tenant_id_offer_letter_number_key" ON "placement_offers"("tenant_id", "offer_letter_number");

-- CreateIndex
CREATE UNIQUE INDEX "placement_joinings_offer_id_key" ON "placement_joinings"("offer_id");

-- CreateIndex
CREATE INDEX "placement_joinings_tenant_id_idx" ON "placement_joinings"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_joinings_offer_id_idx" ON "placement_joinings"("offer_id");

-- CreateIndex
CREATE INDEX "placement_outcomes_tenant_id_idx" ON "placement_outcomes"("tenant_id");

-- CreateIndex
CREATE INDEX "placement_outcomes_academic_year_id_idx" ON "placement_outcomes"("academic_year_id");

-- CreateIndex
CREATE INDEX "placement_outcomes_student_id_idx" ON "placement_outcomes"("student_id");

-- CreateIndex
CREATE INDEX "placement_outcomes_tenant_id_outcome_status_idx" ON "placement_outcomes"("tenant_id", "outcome_status");

-- CreateIndex
CREATE UNIQUE INDEX "placement_outcomes_tenant_id_academic_year_id_student_id_key" ON "placement_outcomes"("tenant_id", "academic_year_id", "student_id");

-- AddForeignKey
ALTER TABLE "placement_companies" ADD CONSTRAINT "placement_companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_contacts" ADD CONSTRAINT "placement_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_contacts" ADD CONSTRAINT "placement_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "placement_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_drives" ADD CONSTRAINT "placement_drives_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_drives" ADD CONSTRAINT "placement_drives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "placement_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_drives" ADD CONSTRAINT "placement_drives_coordinator_contact_id_fkey" FOREIGN KEY ("coordinator_contact_id") REFERENCES "placement_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_positions" ADD CONSTRAINT "placement_positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_positions" ADD CONSTRAINT "placement_positions_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_eligibility" ADD CONSTRAINT "placement_eligibility_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_eligibility" ADD CONSTRAINT "placement_eligibility_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_eligibility" ADD CONSTRAINT "placement_eligibility_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "placement_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_eligibility" ADD CONSTRAINT "placement_eligibility_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_resumes" ADD CONSTRAINT "placement_resumes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_resumes" ADD CONSTRAINT "placement_resumes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "placement_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_applications" ADD CONSTRAINT "placement_applications_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "placement_resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_rounds" ADD CONSTRAINT "placement_rounds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_rounds" ADD CONSTRAINT "placement_rounds_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_round_results" ADD CONSTRAINT "placement_round_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_round_results" ADD CONSTRAINT "placement_round_results_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "placement_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_round_results" ADD CONSTRAINT "placement_round_results_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "placement_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_selections" ADD CONSTRAINT "placement_selections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_selections" ADD CONSTRAINT "placement_selections_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_selections" ADD CONSTRAINT "placement_selections_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "placement_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_selections" ADD CONSTRAINT "placement_selections_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "placement_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_selections" ADD CONSTRAINT "placement_selections_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "placement_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "placement_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "placement_selections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_offers" ADD CONSTRAINT "placement_offers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_joinings" ADD CONSTRAINT "placement_joinings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_joinings" ADD CONSTRAINT "placement_joinings_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_joinings" ADD CONSTRAINT "placement_joinings_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "placement_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_drive_id_fkey" FOREIGN KEY ("drive_id") REFERENCES "placement_drives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "placement_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_outcomes" ADD CONSTRAINT "placement_outcomes_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "placement_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

