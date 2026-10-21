-- Cross-tenant workspace directory.
--
-- User rows stay tenant-scoped (users.tenant_id, unique on (tenant_id, email)); this table is the
-- control-plane index that answers "which colleges can this email sign in to?" without querying
-- every tenant store. It intentionally has no FK to users because a tenant may live in its own
-- DEDICATED_* database.

CREATE TABLE `tenant_memberships` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_memberships_email_tenant_id_key`(`email`, `tenant_id`),
    INDEX `tenant_memberships_tenant_id_idx`(`tenant_id`),
    INDEX `tenant_memberships_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_memberships`
    ADD CONSTRAINT `tenant_memberships_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one row per existing user. `updated_at` has no DB default (Prisma owns it), so supply
-- NOW(3) explicitly. Idempotent: reruns refresh the mapping instead of failing on the unique key.
INSERT INTO `tenant_memberships` (`id`, `email`, `tenant_id`, `user_id`, `is_active`, `updated_at`)
SELECT UUID(), LOWER(TRIM(`email`)), `tenant_id`, `id`, (`status` = 'ACTIVE'), NOW(3)
FROM `users`
ON DUPLICATE KEY UPDATE
    `user_id` = VALUES(`user_id`),
    `is_active` = VALUES(`is_active`),
    `updated_at` = VALUES(`updated_at`);
