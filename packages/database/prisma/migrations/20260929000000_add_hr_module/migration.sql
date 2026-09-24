-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('FACULTY', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeEmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "JoiningStatus" AS ENUM ('PENDING', 'ONBOARDED', 'CONFIRMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EmployeeExitType" AS ENUM ('RESIGNATION', 'RETIREMENT', 'TERMINATION', 'END_OF_CONTRACT', 'MUTUAL_SEPARATION');

-- CreateEnum
CREATE TYPE "EmployeeDocumentType" AS ENUM ('APPOINTMENT_LETTER', 'OFFER_LETTER', 'ID_PROOF', 'EDUCATIONAL_CERTIFICATE', 'EXPERIENCE_LETTER', 'PAYSLIP', 'RELIEVING_LETTER', 'NO_DUE_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "FacultyWorkloadType" AS ENUM ('TEACHING', 'ADMINISTRATIVE', 'RESEARCH', 'EXAM_DUTY', 'EXTENSION', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveCategory" AS ENUM ('CASUAL', 'SICK', 'EARNED', 'MATERNITY', 'PATERNITY', 'UNPAID', 'HALF_DAY', 'COMPENSATORY', 'SPECIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PerformanceReviewType" AS ENUM ('SELF', 'SUPERVISOR', 'PEER', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "PerformanceReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PROCESSING', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollRunLineStatus" AS ENUM ('DRAFT', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "user_id" UUID,
    "employee_type" "EmployeeType" NOT NULL DEFAULT 'FACULTY',
    "honorific" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" DATE,
    "personal_email" TEXT,
    "phone" TEXT,
    "alternate_phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT DEFAULT 'India',
    "department_id" UUID NOT NULL,
    "designation_id" UUID,
    "campus_id" UUID,
    "reporting_to_id" UUID,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "employment_status" "EmployeeEmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "join_date" DATE,
    "confirmation_date" DATE,
    "exit_date" DATE,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "pan_number" TEXT,
    "aadhaar_number" TEXT,
    "bank_account_number" TEXT,
    "bank_name" TEXT,
    "bank_ifsc" TEXT,
    "uan_number" TEXT,
    "qualification" TEXT,
    "specialization" TEXT,
    "profile_photo_key" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_designations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "department_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hr_designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_joinings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "joining_status" "JoiningStatus" NOT NULL DEFAULT 'PENDING',
    "offer_date" DATE,
    "effective_date" DATE,
    "probation_months" INTEGER,
    "confirmation_date" DATE,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_joinings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_exits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "exit_type" "EmployeeExitType" NOT NULL,
    "effective_date" DATE,
    "last_working_date" DATE,
    "notice_period_days" INTEGER,
    "relieving_date" DATE,
    "reason" TEXT,
    "no_due_status" TEXT DEFAULT 'PENDING',
    "no_due_cleared_at" TIMESTAMP(3),
    "relieving_letter_key" TEXT,
    "settlement_amount" DECIMAL(12,2),
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "document_type" "EmployeeDocumentType" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "file_key" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by_user_id" UUID,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_workloads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "term_id" UUID,
    "workload_type" "FacultyWorkloadType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hours_per_week" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effective_from" DATE,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_workloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LeaveCategory" NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#3b82f6',
    "max_days_per_year" INTEGER,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credited_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availed_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjusted_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closing_balance" DOUBLE PRECISION,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "duration_days" DOUBLE PRECISION NOT NULL,
    "half_day_option" TEXT,
    "reason" TEXT,
    "attachment_key" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_performance_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "review_period_start" DATE,
    "review_period_end" DATE,
    "review_type" "PerformanceReviewType" NOT NULL,
    "status" "PerformanceReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "score" DECIMAL(3,2),
    "goals" JSONB,
    "achievements" TEXT,
    "areas_for_improvement" TEXT,
    "overall_comments" TEXT,
    "reviewer_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "basic_amount" DECIMAL(12,2) NOT NULL,
    "hra_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowances" JSONB,
    "deductions" JSONB,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "processed_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "processed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "salary_structure_id" UUID,
    "days_worked" INTEGER,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "total_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "earnings" JSONB,
    "deductions" JSONB,
    "status" "PayrollRunLineStatus" NOT NULL DEFAULT 'DRAFT',
    "paid_at" TIMESTAMP(3),
    "payslip_document_id" UUID,
    "reference_number" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_idx" ON "employees"("tenant_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_department_id_idx" ON "employees"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_designation_id_idx" ON "employees"("tenant_id", "designation_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_campus_id_idx" ON "employees"("tenant_id", "campus_id");

-- CreateIndex
CREATE INDEX "employees_tenant_id_employee_type_idx" ON "employees"("tenant_id", "employee_type");

-- CreateIndex
CREATE INDEX "employees_tenant_id_employment_status_idx" ON "employees"("tenant_id", "employment_status");

-- CreateIndex
CREATE INDEX "employees_tenant_id_deleted_at_idx" ON "employees"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE INDEX "hr_designations_tenant_id_idx" ON "hr_designations"("tenant_id");

-- CreateIndex
CREATE INDEX "hr_designations_tenant_id_department_id_idx" ON "hr_designations"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "hr_designations_tenant_id_deleted_at_idx" ON "hr_designations"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hr_designations_tenant_id_code_key" ON "hr_designations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "employee_joinings_tenant_id_idx" ON "employee_joinings"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_joinings_tenant_id_employee_id_idx" ON "employee_joinings"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_exits_tenant_id_idx" ON "employee_exits"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_exits_tenant_id_employee_id_idx" ON "employee_exits"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_exits_tenant_id_exit_type_idx" ON "employee_exits"("tenant_id", "exit_type");

-- CreateIndex
CREATE INDEX "employee_documents_tenant_id_idx" ON "employee_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_documents_tenant_id_employee_id_idx" ON "employee_documents"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_documents_tenant_id_document_type_idx" ON "employee_documents"("tenant_id", "document_type");

-- CreateIndex
CREATE INDEX "faculty_workloads_tenant_id_idx" ON "faculty_workloads"("tenant_id");

-- CreateIndex
CREATE INDEX "faculty_workloads_tenant_id_employee_id_term_id_idx" ON "faculty_workloads"("tenant_id", "employee_id", "term_id");

-- CreateIndex
CREATE INDEX "faculty_workloads_tenant_id_workload_type_idx" ON "faculty_workloads"("tenant_id", "workload_type");

-- CreateIndex
CREATE INDEX "leave_types_tenant_id_idx" ON "leave_types"("tenant_id");

-- CreateIndex
CREATE INDEX "leave_types_tenant_id_is_active_idx" ON "leave_types"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenant_id_code_key" ON "leave_types"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "leave_balances_tenant_id_idx" ON "leave_balances"("tenant_id");

-- CreateIndex
CREATE INDEX "leave_balances_tenant_id_employee_id_idx" ON "leave_balances"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_tenant_id_employee_id_leave_type_id_year_key" ON "leave_balances"("tenant_id", "employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_applications_tenant_id_idx" ON "leave_applications"("tenant_id");

-- CreateIndex
CREATE INDEX "leave_applications_tenant_id_employee_id_status_idx" ON "leave_applications"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "leave_applications_tenant_id_status_from_date_idx" ON "leave_applications"("tenant_id", "status", "from_date");

-- CreateIndex
CREATE INDEX "employee_performance_reviews_tenant_id_idx" ON "employee_performance_reviews"("tenant_id");

-- CreateIndex
CREATE INDEX "employee_performance_reviews_tenant_id_employee_id_idx" ON "employee_performance_reviews"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_performance_reviews_tenant_id_status_review_type_idx" ON "employee_performance_reviews"("tenant_id", "status", "review_type");

-- CreateIndex
CREATE INDEX "salary_structures_tenant_id_idx" ON "salary_structures"("tenant_id");

-- CreateIndex
CREATE INDEX "salary_structures_tenant_id_employee_id_is_active_idx" ON "salary_structures"("tenant_id", "employee_id", "is_active");

-- CreateIndex
CREATE INDEX "salary_structures_tenant_id_employee_id_effective_from_idx" ON "salary_structures"("tenant_id", "employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_idx" ON "payroll_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_status_year_idx" ON "payroll_runs"("tenant_id", "status", "year");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_month_year_key" ON "payroll_runs"("tenant_id", "month", "year");

-- CreateIndex
CREATE INDEX "payroll_run_lines_tenant_id_idx" ON "payroll_run_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_run_lines_tenant_id_run_id_idx" ON "payroll_run_lines"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "payroll_run_lines_tenant_id_employee_id_idx" ON "payroll_run_lines"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "hr_designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_reporting_to_id_fkey" FOREIGN KEY ("reporting_to_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_joinings" ADD CONSTRAINT "employee_joinings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_joinings" ADD CONSTRAINT "employee_joinings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_workloads" ADD CONSTRAINT "faculty_workloads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_workloads" ADD CONSTRAINT "faculty_workloads_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_workloads" ADD CONSTRAINT "faculty_workloads_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_performance_reviews" ADD CONSTRAINT "employee_performance_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_performance_reviews" ADD CONSTRAINT "employee_performance_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_performance_reviews" ADD CONSTRAINT "employee_performance_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_processed_by_user_id_fkey" FOREIGN KEY ("processed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_salary_structure_id_fkey" FOREIGN KEY ("salary_structure_id") REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payslip_document_id_fkey" FOREIGN KEY ("payslip_document_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

