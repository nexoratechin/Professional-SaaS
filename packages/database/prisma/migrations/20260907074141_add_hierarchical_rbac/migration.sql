-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'PUBLISH', 'EXPORT', 'REFUND', 'MANAGE');

-- CreateEnum
CREATE TYPE "PermissionScopeType" AS ENUM ('GLOBAL', 'CAMPUS', 'DEPARTMENT', 'PROGRAM', 'OWN');

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "action" "PermissionAction" NOT NULL;

-- AlterTable
ALTER TABLE "role_permissions" ADD COLUMN     "scope_type" "PermissionScopeType" NOT NULL DEFAULT 'GLOBAL';

-- AlterTable
ALTER TABLE "user_roles" ADD COLUMN     "scope_campus_id" UUID,
ADD COLUMN     "scope_department_id" UUID,
ADD COLUMN     "scope_program_id" UUID;

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "department_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "degree_level" TEXT,
    "duration_years" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permissions_module_action_idx" ON "permissions"("module", "action");

-- CreateIndex
CREATE INDEX "user_roles_scope_campus_id_idx" ON "user_roles"("scope_campus_id");

-- CreateIndex
CREATE INDEX "user_roles_scope_department_id_idx" ON "user_roles"("scope_department_id");

-- CreateIndex
CREATE INDEX "user_roles_scope_program_id_idx" ON "user_roles"("scope_program_id");

-- CreateIndex
CREATE INDEX "programs_tenant_id_idx" ON "programs"("tenant_id");

-- CreateIndex
CREATE INDEX "programs_department_id_idx" ON "programs"("department_id");

-- CreateIndex
CREATE INDEX "programs_tenant_id_deleted_at_idx" ON "programs"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenant_id_code_key" ON "programs"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_campus_id_fkey" FOREIGN KEY ("scope_campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_department_id_fkey" FOREIGN KEY ("scope_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_program_id_fkey" FOREIGN KEY ("scope_program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
