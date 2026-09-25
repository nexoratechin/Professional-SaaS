-- Centralized secure document management: versioned, virus-scanned, permission-gated
-- document storage built on top of the existing `documents` table. The legacy columns
-- (category, storage_key, original_filename, mime_type, size_bytes) remain as the
-- denormalized snapshot of the current version; new lifecycle/verification fields are
-- added here, and physical uploads move under document_versions.

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'ERROR', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DocumentGranteeType" AS ENUM ('USER', 'ROLE');

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'AWAITING_SCAN';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'READY';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'VERIFIED';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'REPLACED';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'EXPIRED';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'QUARANTINED';

-- AlterTable
ALTER TABLE "documents"
ADD COLUMN     "current_version_id" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "document_type_id" UUID,
ADD COLUMN     "expired_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "verification_note" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by" UUID,
ALTER COLUMN "storage_key" DROP NOT NULL,
ALTER COLUMN "original_filename" DROP NOT NULL,
ALTER COLUMN "mime_type" DROP NOT NULL;

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowed_mime_types" JSONB,
    "allowed_extensions" JSONB,
    "max_size_bytes" INTEGER,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "can_expire" BOOLEAN NOT NULL DEFAULT false,
    "retention_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_engine" TEXT,
    "scan_error" TEXT,
    "scanned_at" TIMESTAMP(3),
    "uploaded_by" UUID,
    "confirmed_at" TIMESTAMP(3),
    "replaced_by_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "grantee_type" "DocumentGranteeType" NOT NULL DEFAULT 'USER',
    "grantee_user_id" UUID,
    "grantee_role_id" TEXT,
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_download" BOOLEAN NOT NULL DEFAULT true,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_download_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID,
    "downloaded_by" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_types_tenant_id_idx" ON "document_types"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_tenant_id_code_key" ON "document_types"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storage_key_key" ON "document_versions"("storage_key");

-- CreateIndex
CREATE INDEX "document_versions_tenant_id_idx" ON "document_versions"("tenant_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_idx" ON "document_versions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "document_access_grants_tenant_id_idx" ON "document_access_grants"("tenant_id");

-- CreateIndex
CREATE INDEX "document_access_grants_document_id_idx" ON "document_access_grants"("document_id");

-- CreateIndex
CREATE INDEX "document_access_grants_grantee_user_id_idx" ON "document_access_grants"("grantee_user_id");

-- CreateIndex
CREATE INDEX "document_access_grants_grantee_role_id_idx" ON "document_access_grants"("grantee_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_access_grants_document_id_grantee_type_grantee_use_key" ON "document_access_grants"("document_id", "grantee_type", "grantee_user_id", "grantee_role_id");

-- CreateIndex
CREATE INDEX "document_download_logs_tenant_id_document_id_idx" ON "document_download_logs"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "document_download_logs_document_id_created_at_idx" ON "document_download_logs"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_tenant_id_document_type_id_idx" ON "documents"("tenant_id", "document_type_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_status_idx" ON "documents"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_download_logs" ADD CONSTRAINT "document_download_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_download_logs" ADD CONSTRAINT "document_download_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;