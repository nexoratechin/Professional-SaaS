-- Schema reconciliation for the shared database.
--
-- `platform_maintenance_mode` is deliberately NOT created here: it ships in its own
-- 20261021140000_add_platform_maintenance_mode migration (this file must stay limited to
-- changes the earlier migrations could not express).
--
-- `tenant_memberships.id` needs the UUID() default the schema declares; the original
-- migration created the column without it.

-- AlterTable
ALTER TABLE `student_fee_assignments` MODIFY `effective_date` DATE NOT NULL DEFAULT (CURRENT_DATE);

-- AlterTable
ALTER TABLE `tenant_memberships` MODIFY `id` CHAR(36) NOT NULL DEFAULT (UUID());
