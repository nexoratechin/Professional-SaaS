-- Bulk import / export system.
--
-- Additive only — three new tables, three new enums, and the Tenant back-relations that Prisma
-- requires. No existing table, row or query changes.
--
--   import_jobs      — one import run: uploaded file reference, committed column mapping,
--                      duplicate strategy, lifecycle status and denormalized counters.
--   import_job_rows  — the durable error report: one row per invalid/duplicate/failed source
--                      row, keyed by (job_id, row_number) so a partial retry can pair a file
--                      row back to its previous verdict.
--   import_templates — tenant-saved reusable column mappings.
--
-- The per-entity columns, validation rules and CSV/XLSX codecs live in the @college-erp/imports
-- package, shared by apps/api (parse/preview/validate + job creation) and apps/worker (background
-- apply). Keeping them out of the DB means adding an importable entity needs no migration.
--
-- On delete behaviour:
--   * Tenant is ON DELETE RESTRICT, matching every other tenant-owned table: a tenant is never
--     deleted out from under its import history.
--   * ImportJobRow cascades off ImportJob: the rows only have meaning as that job's report.
--
-- Every table carries a REQUIRED tenant_id so packages/database's DMMF-derived tenant-guard
-- extension auto-scopes it with no further registration.

-- CreateEnum
CREATE TYPE "ImportFileFormat" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'VALIDATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'SKIPPED', 'INSERTED', 'UPDATED', 'FAILED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "format" "ImportFileFormat" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'COMMIT',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "inserted_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "options" JSONB,
    "error_summary" JSONB,
    "message" TEXT,
    "requested_by_id" UUID,
    "retry_of_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "ImportRowStatus" NOT NULL,
    "source_key" TEXT,
    "raw_data" JSONB,
    "mapped_data" JSONB,
    "errors" JSONB,
    "message" TEXT,
    "target_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mapping" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_entity_type_created_at_idx" ON "import_jobs"("tenant_id", "entity_type", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_status_idx" ON "import_jobs"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_rows_job_id_row_number_key" ON "import_job_rows"("job_id", "row_number");

-- CreateIndex
CREATE INDEX "import_job_rows_tenant_id_job_id_status_idx" ON "import_job_rows"("tenant_id", "job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_tenant_id_entity_type_name_key" ON "import_templates"("tenant_id", "entity_type", "name");

-- CreateIndex
CREATE INDEX "import_templates_tenant_id_entity_type_idx" ON "import_templates"("tenant_id", "entity_type");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
