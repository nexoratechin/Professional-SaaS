-- Background job architecture: a central job status/idempotency registry (control-plane, nullable
-- tenant) plus a tenant-owned table for backend-generated PDF artifacts. Purely additive.

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD_LETTERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bull_job_id" TEXT,
    "tenant_id" UUID,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts_made" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "enqueued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "storage_key" TEXT,
    "content_type" TEXT,
    "byte_size" INTEGER,
    "error_message" TEXT,
    "requested_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_queue_idempotency_key_key" ON "background_jobs"("queue", "idempotency_key");

-- CreateIndex
CREATE INDEX "background_jobs_queue_status_idx" ON "background_jobs"("queue", "status");

-- CreateIndex
CREATE INDEX "background_jobs_tenant_id_idx" ON "background_jobs"("tenant_id");

-- CreateIndex
CREATE INDEX "background_jobs_bull_job_id_idx" ON "background_jobs"("bull_job_id");

-- CreateIndex
CREATE INDEX "background_jobs_status_created_at_idx" ON "background_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_status_idx" ON "generated_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "generated_documents_tenant_id_kind_idx" ON "generated_documents"("tenant_id", "kind");

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
