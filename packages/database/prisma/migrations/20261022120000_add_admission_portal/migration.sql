-- Public online admission portal (applicant self-service on /apply/<tenant-slug>).
--
-- Additive only: every new column is nullable or defaulted, so existing admission rows, staff
-- endpoints, reports and exports are unaffected. A session is invisible to the public site until
-- it sets `portal_enabled = 1` and a `public_slug`, so the feature ships dark per tenant/session.

-- AlterTable
ALTER TABLE `admission_sessions`
    ADD COLUMN `public_slug` VARCHAR(191) NULL,
    ADD COLUMN `portal_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `portal_open_at` DATETIME(3) NULL,
    ADD COLUMN `portal_close_at` DATETIME(3) NULL,
    ADD COLUMN `portal_instructions` JSON NULL;

-- AlterTable
ALTER TABLE `admission_applications`
    ADD COLUMN `public_reference` VARCHAR(32) NULL,
    ADD COLUMN `submitted_via` ENUM('STAFF', 'PORTAL') NOT NULL DEFAULT 'STAFF',
    ADD COLUMN `consent_accepted_at` DATETIME(3) NULL,
    ADD COLUMN `consent_version` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `admission_documents`
    ADD COLUMN `uploaded_via` ENUM('STAFF', 'PORTAL') NULL,
    ADD COLUMN `scan_status` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `notifications`
    ADD COLUMN `recipient_address` VARCHAR(320) NULL,
    ADD COLUMN `recipient_name` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `admission_applicant_accesses` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NULL,
    `channel` ENUM('EMAIL', 'PHONE') NOT NULL,
    `contact` VARCHAR(320) NOT NULL,
    `contact_hash` VARCHAR(64) NOT NULL,
    `otp_hash` VARCHAR(64) NULL,
    `otp_expires_at` DATETIME(3) NULL,
    `otp_attempts` INTEGER NOT NULL DEFAULT 0,
    `otp_sent_at` DATETIME(3) NULL,
    `otp_sent_count` INTEGER NOT NULL DEFAULT 0,
    `verified_at` DATETIME(3) NULL,
    `resume_token_hash` VARCHAR(64) NULL,
    `resume_expires_at` DATETIME(3) NULL,
    `ip_hash` VARCHAR(64) NULL,
    `user_agent_hash` VARCHAR(64) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admission_applicant_accesses_tenant_id_channel_contact_hash_key`(`tenant_id`, `channel`, `contact_hash`),
    INDEX `admission_applicant_accesses_tenant_id_application_id_idx`(`tenant_id`, `application_id`),
    INDEX `admission_applicant_accesses_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `admission_sessions_tenant_id_public_slug_key` ON `admission_sessions`(`tenant_id`, `public_slug`);

-- CreateIndex
CREATE UNIQUE INDEX `admission_applications_tenant_id_public_reference_key` ON `admission_applications`(`tenant_id`, `public_reference`);

-- CreateIndex
CREATE INDEX `admission_applications_tenant_id_submitted_via_idx` ON `admission_applications`(`tenant_id`, `submitted_via`);

-- AddForeignKey
ALTER TABLE `admission_applicant_accesses` ADD CONSTRAINT `admission_applicant_accesses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applicant_accesses` ADD CONSTRAINT `admission_applicant_accesses_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
