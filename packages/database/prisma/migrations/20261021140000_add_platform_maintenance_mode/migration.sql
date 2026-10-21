-- Platform-wide maintenance window (control-plane singleton; id = 'singleton').
--
-- The API refuses tenant-realm sign-ins while `enabled` is true, so an operator can take the
-- whole estate offline during a migration/incident without touching individual tenant statuses.
-- The platform admin realm is deliberately never blocked: an operator must be able to sign in
-- and turn maintenance back off.

CREATE TABLE `platform_maintenance_mode` (
    `id` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `message` TEXT NULL,
    `ends_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
