-- CreateEnum
CREATE TYPE "ResultState" AS ENUM ('CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ResultStanding" AS ENUM ('PASSED', 'FAILED', 'SUPPLEMENTARY');

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "grace_policy" JSONB,
ADD COLUMN     "grading_scheme_id" UUID,
ADD COLUMN     "results_locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "student_results" ADD COLUMN     "component_json" JSONB,
ADD COLUMN     "grace_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "grade_point" DOUBLE PRECISION,
ADD COLUMN     "result_calculation_id" UUID;

-- CreateTable
CREATE TABLE "grading_schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pass_mode" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "min_pass_percent" DOUBLE PRECISION,
    "min_pass_grade_point" DOUBLE PRECISION,
    "weighting_mode" TEXT NOT NULL DEFAULT 'CREDIT_WEIGHTED',
    "gpa_max" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "grace_enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_grace_marks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grace_to_pass_diff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rounding_decimals" INTEGER NOT NULL DEFAULT 2,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "min_percent" DOUBLE PRECISION NOT NULL,
    "max_percent" DOUBLE PRECISION NOT NULL,
    "grade_point" DOUBLE PRECISION NOT NULL,
    "grade_description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "subject_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'THEORY',
    "weightage" DOUBLE PRECISION NOT NULL,
    "max_marks" DOUBLE PRECISION NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_component_marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "marks_obtained" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_component_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_calculations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "registration_id" UUID,
    "subject_id" UUID NOT NULL,
    "marks_entry_id" UUID,
    "exam_id" UUID,
    "process_id" UUID,
    "raw_marks" DOUBLE PRECISION,
    "grace_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effective_marks" DOUBLE PRECISION,
    "max_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,
    "grade" TEXT,
    "grade_point" DOUBLE PRECISION,
    "outcome" "ResultOutcome" NOT NULL DEFAULT 'INCOMPLETE',
    "component_json" JSONB,
    "schema_json" JSONB,
    "calculated_at" TIMESTAMP(3),
    "calculated_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_processes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_id" UUID,
    "state" "ResultState" NOT NULL DEFAULT 'CALCULATED',
    "standing" "ResultStanding",
    "subject_count" INTEGER,
    "passed_count" INTEGER,
    "failed_count" INTEGER,
    "total_raw_marks" DOUBLE PRECISION,
    "total_grace_marks" DOUBLE PRECISION,
    "total_effective_marks" DOUBLE PRECISION,
    "total_max_marks" INTEGER,
    "aggregate_percent" DOUBLE PRECISION,
    "credits_attempted" INTEGER,
    "credits_earned" INTEGER,
    "gpa" DOUBLE PRECISION,
    "cgpa" DOUBLE PRECISION,
    "calculation_version" INTEGER NOT NULL DEFAULT 1,
    "calculated_at" TIMESTAMP(3),
    "calculated_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "process_id" UUID,
    "student_id" UUID,
    "event" TEXT NOT NULL,
    "fromState" "ResultState",
    "toState" "ResultState",
    "details" JSONB,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grading_schemes_tenant_id_idx" ON "grading_schemes"("tenant_id");

-- CreateIndex
CREATE INDEX "grading_schemes_tenant_id_is_default_idx" ON "grading_schemes"("tenant_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_tenant_id_code_key" ON "grading_schemes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "grade_scales_tenant_id_scheme_id_idx" ON "grade_scales"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_tenant_id_scheme_id_grade_key" ON "grade_scales"("tenant_id", "scheme_id", "grade");

-- CreateIndex
CREATE INDEX "assessment_components_tenant_id_session_id_idx" ON "assessment_components"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "assessment_components_tenant_id_subject_id_idx" ON "assessment_components"("tenant_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_tenant_id_session_id_subject_id_code_key" ON "assessment_components"("tenant_id", "session_id", "subject_id", "code");

-- CreateIndex
CREATE INDEX "exam_component_marks_tenant_id_component_id_idx" ON "exam_component_marks"("tenant_id", "component_id");

-- CreateIndex
CREATE INDEX "exam_component_marks_tenant_id_registration_id_idx" ON "exam_component_marks"("tenant_id", "registration_id");

-- CreateIndex
CREATE INDEX "exam_component_marks_tenant_id_subject_id_idx" ON "exam_component_marks"("tenant_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_component_marks_tenant_id_registration_id_subject_id_c_key" ON "exam_component_marks"("tenant_id", "registration_id", "subject_id", "component_id");

-- CreateIndex
CREATE INDEX "result_calculations_tenant_id_session_id_idx" ON "result_calculations"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "result_calculations_tenant_id_student_id_idx" ON "result_calculations"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "result_calculations_tenant_id_subject_id_idx" ON "result_calculations"("tenant_id", "subject_id");

-- CreateIndex
CREATE INDEX "result_calculations_tenant_id_process_id_idx" ON "result_calculations"("tenant_id", "process_id");

-- CreateIndex
CREATE INDEX "result_calculations_tenant_id_outcome_idx" ON "result_calculations"("tenant_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "result_calculations_tenant_id_session_id_student_id_subject_key" ON "result_calculations"("tenant_id", "session_id", "student_id", "subject_id");

-- CreateIndex
CREATE INDEX "result_processes_tenant_id_session_id_idx" ON "result_processes"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "result_processes_tenant_id_student_id_idx" ON "result_processes"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "result_processes_tenant_id_state_idx" ON "result_processes"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "result_processes_tenant_id_session_id_student_id_key" ON "result_processes"("tenant_id", "session_id", "student_id");

-- CreateIndex
CREATE INDEX "result_history_tenant_id_session_id_idx" ON "result_history"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "result_history_tenant_id_student_id_idx" ON "result_history"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "result_history_tenant_id_process_id_idx" ON "result_history"("tenant_id", "process_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_results_result_calculation_id_key" ON "student_results"("result_calculation_id");

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_grading_scheme_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "grading_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_marks" ADD CONSTRAINT "exam_component_marks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_marks" ADD CONSTRAINT "exam_component_marks_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_marks" ADD CONSTRAINT "exam_component_marks_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_marks" ADD CONSTRAINT "exam_component_marks_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "assessment_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_component_marks" ADD CONSTRAINT "exam_component_marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "exam_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "exam_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_marks_entry_id_fkey" FOREIGN KEY ("marks_entry_id") REFERENCES "exam_marks_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "student_exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_calculations" ADD CONSTRAINT "result_calculations_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "result_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_processes" ADD CONSTRAINT "result_processes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_processes" ADD CONSTRAINT "result_processes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_processes" ADD CONSTRAINT "result_processes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_processes" ADD CONSTRAINT "result_processes_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "student_exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "result_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_history" ADD CONSTRAINT "result_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_results" ADD CONSTRAINT "student_results_result_calculation_id_fkey" FOREIGN KEY ("result_calculation_id") REFERENCES "result_calculations"("id") ON DELETE SET NULL ON UPDATE CASCADE;