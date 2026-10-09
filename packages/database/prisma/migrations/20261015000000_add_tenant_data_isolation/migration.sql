-- Enterprise database isolation architecture.
--
-- Adds a configurable per-tenant physical-storage mode on top of the existing shared-PostgreSQL
-- + tenant_id model:
--   SHARED             (default) rows live in the shared DB, filtered by tenant_id
--   DEDICATED_SCHEMA   the tenant's tables live in their own Postgres schema in the shared DB
--   DEDICATED_DATABASE the tenant's tables live in their own Postgres database
--
-- Additive and non-breaking: every existing tenant keeps the SHARED default and needs no action.
-- Existing tenants are deliberately NOT migrated automatically — moving a tenant to a dedicated
-- store is an explicit, operator-driven action (see tenant_databases below and the API's
-- /tenants/:id/database endpoints). See docs/enterprise-database-isolation.md.

-- CreateEnum
CREATE TYPE "TenantDataIsolationMode" AS ENUM ('SHARED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE');

-- CreateEnum
CREATE TYPE "TenantDatabaseProvisionStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'PROVISIONING', 'MIGRATING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "data_isolation_mode" "TenantDataIsolationMode" NOT NULL DEFAULT 'SHARED';

-- CreateTable
CREATE TABLE "tenant_databases" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mode" "TenantDataIsolationMode" NOT NULL,
    "status" "TenantDatabaseProvisionStatus" NOT NULL DEFAULT 'PENDING',
    "schema_name" TEXT,
    "database_name" TEXT,
    "connection_url_encrypted" TEXT,
    "applied_migration_count" INTEGER NOT NULL DEFAULT 0,
    "last_applied_migration" TEXT,
    "last_migrated_at" TIMESTAMP(3),
    "provisioned_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_databases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_databases_tenant_id_key" ON "tenant_databases"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_databases_status_idx" ON "tenant_databases"("status");

-- CreateIndex
CREATE INDEX "tenants_data_isolation_mode_idx" ON "tenants"("data_isolation_mode");

-- AddForeignKey
ALTER TABLE "tenant_databases"
    ADD CONSTRAINT "tenant_databases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
