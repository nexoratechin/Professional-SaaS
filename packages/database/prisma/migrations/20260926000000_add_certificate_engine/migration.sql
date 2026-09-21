-- Certificate engine: template-based, configurable certificate generation
-- (request -> generate -> approve -> issue -> revoke/reissue) with QR verification,
-- immutable content snapshots, numbering chains and append-only history.
-- Generated schema matches packages/database/prisma/schema.prisma

-- AlterEnum
ALTER TYPE "CertificateType" ADD VALUE 'GRADE_CARD';

-- AlterEnum
ALTER TYPE "CertificateType" ADD VALUE 'MARKSHEET';

-- AlterEnum
ALTER TYPE "CertificateType" ADD VALUE 'CHARACTER_CERTIFICATE';

-- AlterEnum
ALTER TYPE "CertificateType" ADD VALUE 'TESTIMONIAL';

-- AlterEnum
ALTER TYPE "CertificateStatus" ADD VALUE 'REVOKED';

-- AlterTable
ALTER TABLE "student_certificates" ADD COLUMN "template_id" UUID,
ADD COLUMN "qr_token" TEXT,
ADD COLUMN "content_json" JSONB,
ADD COLUMN "revoked_at" TIMESTAMP(3),
ADD COLUMN "revoked_by_user_id" UUID,
ADD COLUMN "revoke_reason" TEXT,
ADD COLUMN "reissued_from_id" UUID;

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "certificate_type" "CertificateType" NOT NULL,
    "field_config_json" JSONB,
    "branding_json" JSONB,
    "numbering_json" JSONB,
    "qr_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_history_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "from_status" "CertificateStatus" NOT NULL,
    "to_status" "CertificateStatus" NOT NULL,
    "actor_user_id" UUID,
    "detail_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_history_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_certificates_qr_token_key" ON "student_certificates"("qr_token");

-- CreateIndex
CREATE INDEX "student_certificates_tenant_id_certificate_type_idx" ON "student_certificates"("tenant_id", "certificate_type");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_templates_tenant_id_code_key" ON "certificate_templates"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "certificate_templates_tenant_id_certificate_type_idx" ON "certificate_templates"("tenant_id", "certificate_type");

-- CreateIndex
CREATE INDEX "certificate_history_rows_tenant_id_certificate_id_idx" ON "certificate_history_rows"("tenant_id", "certificate_id");

-- AddForeignKey
ALTER TABLE "student_certificates" ADD CONSTRAINT "student_certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_certificates" ADD CONSTRAINT "student_certificates_reissued_from_id_fkey" FOREIGN KEY ("reissued_from_id") REFERENCES "student_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_history_rows" ADD CONSTRAINT "certificate_history_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_history_rows" ADD CONSTRAINT "certificate_history_rows_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "student_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;