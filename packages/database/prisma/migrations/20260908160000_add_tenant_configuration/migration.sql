-- Tenant configuration engine: a single JSONB document per tenant carrying branding,
-- academic calendar, grading, attendance, fee, admissions, numbering, and template config.
CREATE TABLE "tenant_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configurations_pkey" PRIMARY KEY ("id")
);

-- One configuration row per tenant.
CREATE UNIQUE INDEX "tenant_configurations_tenant_id_key" ON "tenant_configurations"("tenant_id");

-- Foreign key: tenant_configurations.tenant_id -> tenants.id (restrict, matching convention)
ALTER TABLE "tenant_configurations"
    ADD CONSTRAINT "tenant_configurations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;