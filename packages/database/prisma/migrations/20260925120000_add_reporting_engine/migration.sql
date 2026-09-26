-- Reporting engine: saved configurations, templates, recurring schedules and durable async export
-- run history. Predefined report definitions live in @college-erp/reporting; these tables persist
-- only tenant-owned configuration and execution state.

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('ADMISSIONS', 'STUDENTS', 'ATTENDANCE', 'FEES', 'EXAMS', 'PLACEMENTS', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'INVENTORY');

-- CreateEnum
CREATE TYPE "ReportExportFormat" AS ENUM ('CSV', 'EXCEL', 'PDF');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "filters" JSONB NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "report_type" "ReportType" NOT NULL,
    "definition" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "template_id" UUID,
    "created_by_id" UUID NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "format" "ReportExportFormat" NOT NULL,
    "filters" JSONB NOT NULL,
    "scope_snapshot" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "time_of_day" VARCHAR(5) NOT NULL,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "format" "ReportExportFormat" NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "filters" JSONB NOT NULL,
    "scope_snapshot" JSONB NOT NULL,
    "template_snapshot" JSONB,
    "requested_by_id" UUID,
    "saved_report_id" UUID,
    "template_id" UUID,
    "schedule_id" UUID,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "file_name" TEXT,
    "object_key" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_reports_tenant_id_idx" ON "saved_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "saved_reports_tenant_id_owner_id_idx" ON "saved_reports"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "saved_reports_tenant_id_report_type_idx" ON "saved_reports"("tenant_id", "report_type");

-- CreateIndex
CREATE UNIQUE INDEX "saved_reports_tenant_id_owner_id_name_key" ON "saved_reports"("tenant_id", "owner_id", "name");

-- CreateIndex
CREATE INDEX "report_templates_tenant_id_idx" ON "report_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "report_templates_tenant_id_report_type_idx" ON "report_templates"("tenant_id", "report_type");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_tenant_id_name_key" ON "report_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "report_schedules_tenant_id_idx" ON "report_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "report_schedules_tenant_id_created_by_id_idx" ON "report_schedules"("tenant_id", "created_by_id");

-- CreateIndex
CREATE INDEX "report_schedules_tenant_id_is_active_next_run_at_idx" ON "report_schedules"("tenant_id", "is_active", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_tenant_id_name_key" ON "report_schedules"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "report_runs_tenant_id_idx" ON "report_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "report_runs_tenant_id_status_created_at_idx" ON "report_runs"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "report_runs_tenant_id_requested_by_id_idx" ON "report_runs"("tenant_id", "requested_by_id");

-- CreateIndex
CREATE INDEX "report_runs_tenant_id_schedule_id_idx" ON "report_runs"("tenant_id", "schedule_id");

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_saved_report_id_fkey" FOREIGN KEY ("saved_report_id") REFERENCES "saved_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the reports.manage permission (idempotent: key is globally unique).
INSERT INTO "permissions" ("id", "key", "module", "action", "description", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'reports.manage', 'reports', 'MANAGE', 'Manage saved reports, templates, schedules, and report runs.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Grant reports.manage to every role that already holds a GLOBAL reports.view grant, preserving the
-- existing global access boundary. Department/campus/program-scoped report viewers are intentionally
-- not auto-granted tenant-wide manage.
INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "scope_type", "created_at")
SELECT gen_random_uuid(), view_grant."tenant_id", view_grant."role_id", manage_permission."id", view_grant."scope_type", CURRENT_TIMESTAMP
FROM "role_permissions" AS view_grant
JOIN "permissions" AS view_permission ON view_permission."id" = view_grant."permission_id" AND view_permission."key" = 'reports.view'
CROSS JOIN "permissions" AS manage_permission
WHERE manage_permission."key" = 'reports.manage'
  AND view_grant."scope_type" = 'GLOBAL'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
