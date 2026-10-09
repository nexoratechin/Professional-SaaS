-- Per-campus configuration engine: a single JSONB document per campus carrying campus-level
-- configuration carried alongside the tenant configuration (timezone, branding, academic
-- calendar, attendance thresholds, fee rules, numbering, templates). CRUD API lives in
-- apps/api's campus module; the row is created lazily on first read with the tenant's global
-- campus defaults, exactly like tenant_configurations.
CREATE TABLE "campus_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_configurations_pkey" PRIMARY KEY ("id")
);

-- One configuration row per campus (campus ids are globally-unique UUIDs, so the single-column
-- unique index is the "one row per campus" guarantee).
CREATE UNIQUE INDEX "campus_configurations_campus_id_key" ON "campus_configurations"("campus_id");

-- Tenant-scoped lookups: the tenant-guard Prisma extension injects tenant_id on every query, so
-- every list/aggregate over a tenant's campus configs goes through this index.
CREATE INDEX "campus_configurations_tenant_id_idx" ON "campus_configurations"("tenant_id");

-- Foreign key: campus_configurations.tenant_id -> tenants.id (restrict, matching convention)
ALTER TABLE "campus_configurations"
    ADD CONSTRAINT "campus_configurations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign key: campus_configurations.campus_id -> campuses.id (cascade: archiving/deleting a
-- campus removes its configuration along with the rest of its rows).
ALTER TABLE "campus_configurations"
    ADD CONSTRAINT "campus_configurations_campus_id_fkey"
    FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;