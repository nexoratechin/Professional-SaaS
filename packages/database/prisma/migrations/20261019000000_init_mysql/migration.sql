-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `slug` VARCHAR(512) NOT NULL,
    `name` TEXT NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED') NOT NULL DEFAULT 'TRIAL',
    `billing_email` TEXT NOT NULL,
    `timezone` VARCHAR(255) NOT NULL DEFAULT 'Asia/Kolkata',
    `data_isolation_mode` ENUM('SHARED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE') NOT NULL DEFAULT 'SHARED',
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    INDEX `tenants_status_idx`(`status`),
    INDEX `tenants_created_at_idx`(`created_at`),
    INDEX `tenants_data_isolation_mode_idx`(`data_isolation_mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_databases` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `mode` ENUM('SHARED', 'DEDICATED_SCHEMA', 'DEDICATED_DATABASE') NOT NULL,
    `status` ENUM('NOT_APPLICABLE', 'PENDING', 'PROVISIONING', 'MIGRATING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `schema_name` TEXT NULL,
    `database_name` TEXT NULL,
    `connection_url_encrypted` TEXT NULL,
    `applied_migration_count` INTEGER NOT NULL DEFAULT 0,
    `last_applied_migration` TEXT NULL,
    `last_migrated_at` DATETIME(3) NULL,
    `provisioned_at` DATETIME(3) NULL,
    `failure_reason` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_databases_tenant_id_key`(`tenant_id`),
    INDEX `tenant_databases_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(512) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `price_cents` INTEGER NULL,
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `billing_cycle` ENUM('MONTHLY', 'ANNUAL', 'ONE_TIME') NOT NULL DEFAULT 'ANNUAL',
    `is_custom` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'TRIALING',
    `billing_cycle` ENUM('MONTHLY', 'ANNUAL', 'ONE_TIME') NOT NULL,
    `current_period_start` DATETIME(3) NOT NULL,
    `current_period_end` DATETIME(3) NOT NULL,
    `canceled_at` DATETIME(3) NULL,
    `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_tenant_id_idx`(`tenant_id`),
    INDEX `subscriptions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `subscriptions_current_period_start_idx`(`current_period_start`),
    INDEX `subscriptions_status_current_period_end_idx`(`status`, `current_period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_items` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `subscription_id` VARCHAR(512) NOT NULL,
    `item_type` ENUM('BASE', 'PER_STUDENT', 'PER_CAMPUS', 'ADDON_MODULE', 'CUSTOM') NOT NULL,
    `description` TEXT NOT NULL,
    `module_key` TEXT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price_cents` INTEGER NOT NULL,
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscription_items_tenant_id_idx`(`tenant_id`),
    INDEX `subscription_items_subscription_id_idx`(`subscription_id`),
    INDEX `subscription_items_tenant_id_item_type_idx`(`tenant_id`, `item_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(512) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `module` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `feature_flags_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_feature_flags` (
    `id` VARCHAR(512) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `feature_flag_id` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `plan_feature_flags_plan_id_feature_flag_id_key`(`plan_id`, `feature_flag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_modules` (
    `id` VARCHAR(512) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `module_key` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `type` ENUM('BOOLEAN', 'QUANTITY') NOT NULL DEFAULT 'BOOLEAN',
    `limit_value` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `plan_modules_plan_id_module_key_key`(`plan_id`, `module_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_feature_flags` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `feature_flag_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `reason` TEXT NULL,
    `created_by_platform_user_id` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_feature_flags_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `tenant_feature_flags_tenant_id_feature_flag_id_key`(`tenant_id`, `feature_flag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_events` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(18, 4) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    INDEX `usage_events_tenant_id_event_type_occurred_at_idx`(`tenant_id`, `event_type`, `occurred_at`),
    INDEX `usage_events_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entitlements` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `type` ENUM('BOOLEAN', 'QUANTITY') NOT NULL DEFAULT 'BOOLEAN',
    `bool_value` BOOLEAN NOT NULL DEFAULT false,
    `limit_value` INTEGER NULL,
    `source` ENUM('PLAN', 'PLAN_MODULE', 'TENANT_OVERRIDE', 'SUBSCRIPTION_ITEM') NOT NULL,
    `source_ref` TEXT NULL,
    `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effective_until` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `entitlements_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `entitlements_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `subscription_id` VARCHAR(512) NULL,
    `invoice_number` VARCHAR(512) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `subtotal_cents` INTEGER NOT NULL,
    `tax_cents` INTEGER NOT NULL DEFAULT 0,
    `total_cents` INTEGER NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `issued_at` DATETIME(3) NULL,
    `due_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `voided_at` DATETIME(3) NULL,
    `created_by_platform_user_id` TEXT NULL,
    `pdf_storage_key` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_invoice_number_key`(`invoice_number`),
    INDEX `invoices_tenant_id_idx`(`tenant_id`),
    INDEX `invoices_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `invoices_period_start_idx`(`period_start`),
    INDEX `invoices_status_period_start_idx`(`status`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `subscription_id` VARCHAR(512) NOT NULL,
    `invoice_id` VARCHAR(512) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `method` ENUM('CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE') NOT NULL,
    `gateway_reference` VARCHAR(512) NULL,
    `failure_reason` TEXT NULL,
    `paid_at` DATETIME(3) NULL,
    `refunded_at` DATETIME(3) NULL,
    `created_by_platform_user_id` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_gateway_reference_key`(`gateway_reference`),
    INDEX `payments_tenant_id_idx`(`tenant_id`),
    INDEX `payments_invoice_id_idx`(`invoice_id`),
    INDEX `payments_subscription_id_idx`(`subscription_id`),
    INDEX `payments_status_idx`(`status`),
    INDEX `payments_paid_at_idx`(`paid_at`),
    INDEX `payments_status_paid_at_idx`(`status`, `paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_config` (
    `id` VARCHAR(512) NOT NULL DEFAULT 'default',
    `tax_name` VARCHAR(255) NOT NULL DEFAULT 'GST',
    `tax_rate_bps` INTEGER NOT NULL DEFAULT 1800,
    `invoice_prefix` VARCHAR(255) NOT NULL DEFAULT 'INV',
    `next_invoice_sequence` INTEGER NOT NULL DEFAULT 1,
    `grace_period_days` INTEGER NOT NULL DEFAULT 7,
    `renewal_due_days` INTEGER NOT NULL DEFAULT 15,
    `retry_interval_days` INTEGER NOT NULL DEFAULT 1,
    `proration_enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_by_platform_user_id` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_line_items` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `invoice_id` VARCHAR(512) NOT NULL,
    `description` TEXT NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price_cents` INTEGER NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `invoice_line_items_tenant_id_idx`(`tenant_id`),
    INDEX `invoice_line_items_invoice_id_idx`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `subject` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `raised_by_user_id` CHAR(36) NULL,
    `raised_by_platform_user_id` TEXT NULL,
    `assigned_to_platform_user_id` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `support_tickets_tenant_id_idx`(`tenant_id`),
    INDEX `support_tickets_status_idx`(`status`),
    INDEX `support_tickets_assigned_to_platform_user_id_idx`(`assigned_to_platform_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_ticket_comments` (
    `id` VARCHAR(512) NOT NULL,
    `ticket_id` VARCHAR(512) NOT NULL,
    `author_type` TEXT NOT NULL,
    `author_user_id` CHAR(36) NULL,
    `author_platform_user_id` TEXT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_ticket_comments_ticket_id_idx`(`ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_audit_logs` (
    `id` VARCHAR(512) NOT NULL,
    `scope` ENUM('PLATFORM', 'TENANT') NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `actor_type` TEXT NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `actor_platform_user_id` TEXT NULL,
    `actor_email` VARCHAR(512) NULL,
    `action` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL DEFAULT 'platform',
    `entity_type` TEXT NOT NULL,
    `entity_id` TEXT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip_address` TEXT NULL,
    `user_agent` TEXT NULL,
    `request_id` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_audit_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `platform_audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `platform_audit_logs_module_created_at_idx`(`module`, `created_at`),
    INDEX `platform_audit_logs_request_id_idx`(`request_id`),
    INDEX `platform_audit_logs_actor_email_idx`(`actor_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_alerts` (
    `id` VARCHAR(512) NOT NULL,
    `rule_key` VARCHAR(191) NOT NULL,
    `dedupe_key` VARCHAR(191) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL,
    `status` ENUM('FIRING', 'ACKNOWLEDGED', 'RESOLVED') NOT NULL DEFAULT 'FIRING',
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `source` VARCHAR(255) NOT NULL DEFAULT 'api',
    `metric_name` TEXT NULL,
    `metric_value` DECIMAL(18, 4) NULL,
    `threshold` DECIMAL(18, 4) NULL,
    `details` JSON NULL,
    `fired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_platform_user_id` TEXT NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `system_alerts_status_severity_last_seen_at_idx`(`status`, `severity`, `last_seen_at`),
    INDEX `system_alerts_rule_key_dedupe_key_status_idx`(`rule_key`, `dedupe_key`, `status`),
    INDEX `system_alerts_fired_at_idx`(`fired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_error_events` (
    `id` VARCHAR(512) NOT NULL,
    `fingerprint` VARCHAR(512) NOT NULL,
    `level` VARCHAR(255) NOT NULL DEFAULT 'error',
    `source` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `route` TEXT NULL,
    `method` TEXT NULL,
    `request_id` TEXT NULL,
    `tenant_id` CHAR(36) NULL,
    `user_id` TEXT NULL,
    `context` JSON NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,

    UNIQUE INDEX `system_error_events_fingerprint_key`(`fingerprint`),
    INDEX `system_error_events_source_last_seen_at_idx`(`source`, `last_seen_at`),
    INDEX `system_error_events_last_seen_at_idx`(`last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_users` (
    `id` VARCHAR(512) NOT NULL,
    `email` VARCHAR(512) NOT NULL,
    `password_hash` TEXT NOT NULL,
    `full_name` TEXT NOT NULL,
    `role` ENUM('PLATFORM_ADMIN', 'PLATFORM_SUPPORT') NOT NULL DEFAULT 'PLATFORM_SUPPORT',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `failed_login_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `mfa_secret_encrypted` TEXT NULL,
    `mfa_enabled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_sessions` (
    `id` VARCHAR(512) NOT NULL,
    `platform_user_id` VARCHAR(512) NOT NULL,
    `refresh_token_hash` VARCHAR(512) NOT NULL,
    `user_agent` TEXT NULL,
    `ip_address` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_sessions_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `platform_sessions_platform_user_id_idx`(`platform_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` TEXT NULL,
    `full_name` TEXT NOT NULL,
    `phone` TEXT NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'INVITED',
    `email_verified_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `failed_login_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `mfa_secret_encrypted` TEXT NULL,
    `mfa_enabled_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `users_tenant_id_idx`(`tenant_id`),
    INDEX `users_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `users_last_login_at_idx`(`last_login_at`),
    UNIQUE INDEX `users_tenant_id_email_key`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `roles_tenant_id_idx`(`tenant_id`),
    INDEX `roles_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `roles_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `key` VARCHAR(512) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `action` ENUM('VIEW', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'PUBLISH', 'EXPORT', 'REFUND', 'MANAGE') NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    INDEX `permissions_module_action_idx`(`module`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,
    `scope_type` ENUM('GLOBAL', 'CAMPUS', 'DEPARTMENT', 'PROGRAM', 'OWN') NOT NULL DEFAULT 'GLOBAL',
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `role_permissions_role_id_permission_id_key`(`role_id`, `permission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `scope_campus_id` CHAR(36) NULL,
    `scope_department_id` CHAR(36) NULL,
    `scope_program_id` CHAR(36) NULL,
    `assigned_by_user_id` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_tenant_id_idx`(`tenant_id`),
    INDEX `user_roles_user_id_idx`(`user_id`),
    INDEX `user_roles_scope_campus_id_idx`(`scope_campus_id`),
    INDEX `user_roles_scope_department_id_idx`(`scope_department_id`),
    INDEX `user_roles_scope_program_id_idx`(`scope_program_id`),
    UNIQUE INDEX `user_roles_tenant_id_user_id_role_id_key`(`tenant_id`, `user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `refresh_token_hash` VARCHAR(512) NOT NULL,
    `user_agent` TEXT NULL,
    `ip_address` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `sessions_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_events` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NULL,
    `email_attempted` VARCHAR(191) NOT NULL,
    `result` ENUM('SUCCESS', 'FAILED_PASSWORD', 'FAILED_TENANT_SUSPENDED', 'FAILED_USER_INACTIVE', 'FAILED_UNKNOWN_EMAIL', 'FAILED_ACCOUNT_LOCKED', 'FAILED_SUSPICIOUS_LOGIN_BLOCKED', 'FAILED_SSO', 'FAILED_SSO_UNKNOWN_PROVIDER', 'FAILED_SSO_PROVIDER_DISABLED', 'FAILED_SSO_DOMAIN_NOT_ALLOWED', 'FAILED_SSO_USER_NOT_PROVISIONED', 'FAILED_SSO_EMAIL_UNVERIFIED', 'FAILED_LOCAL_AUTH_DISABLED') NOT NULL,
    `auth_method` ENUM('PASSWORD', 'SSO') NOT NULL DEFAULT 'PASSWORD',
    `identity_provider_id` CHAR(36) NULL,
    `ip_address` TEXT NULL,
    `user_agent` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_events_tenant_id_occurred_at_idx`(`tenant_id`, `occurred_at`),
    INDEX `login_events_email_attempted_occurred_at_idx`(`email_attempted`, `occurred_at`),
    INDEX `login_events_identity_provider_id_occurred_at_idx`(`identity_provider_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(512) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `password_reset_tokens_tenant_id_idx`(`tenant_id`),
    INDEX `password_reset_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_verification_tokens` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(512) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_verification_tokens_token_hash_key`(`token_hash`),
    INDEX `email_verification_tokens_tenant_id_idx`(`tenant_id`),
    INDEX `email_verification_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_backup_codes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `code_hash` VARCHAR(512) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mfa_backup_codes_code_hash_key`(`code_hash`),
    INDEX `mfa_backup_codes_tenant_id_idx`(`tenant_id`),
    INDEX `mfa_backup_codes_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_mfa_backup_codes` (
    `id` VARCHAR(512) NOT NULL,
    `platform_user_id` VARCHAR(512) NOT NULL,
    `code_hash` VARCHAR(512) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_mfa_backup_codes_code_hash_key`(`code_hash`),
    INDEX `platform_mfa_backup_codes_platform_user_id_idx`(`platform_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trusted_devices` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_token_hash` VARCHAR(512) NOT NULL,
    `label` TEXT NULL,
    `user_agent` TEXT NULL,
    `ip_address` TEXT NULL,
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trusted_devices_device_token_hash_key`(`device_token_hash`),
    INDEX `trusted_devices_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_history` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `password_hash` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `password_history_tenant_id_idx`(`tenant_id`),
    INDEX `password_history_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_events` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `scope` ENUM('PLATFORM', 'TENANT') NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `platform_user_id` VARCHAR(512) NULL,
    `event_type` ENUM('MFA_ENABLED', 'MFA_DISABLED', 'MFA_CHALLENGE_SUCCEEDED', 'MFA_CHALLENGE_FAILED', 'BACKUP_CODE_USED', 'BACKUP_CODES_REGENERATED', 'NEW_DEVICE_LOGIN', 'SUSPICIOUS_LOGIN_FLAGGED', 'SUSPICIOUS_LOGIN_BLOCKED', 'TRUSTED_DEVICE_ADDED', 'TRUSTED_DEVICE_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_REUSE_BLOCKED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'SESSION_REVOKED', 'ALL_SESSIONS_REVOKED', 'SSO_LOGIN_SUCCEEDED', 'SSO_LOGIN_FAILED', 'SSO_USER_PROVISIONED', 'SSO_IDENTITY_LINKED', 'SSO_IDENTITY_UNLINKED') NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `ip_address` TEXT NULL,
    `user_agent` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `security_events_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `security_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `security_events_platform_user_id_created_at_idx`(`platform_user_id`, `created_at`),
    INDEX `security_events_event_type_created_at_idx`(`event_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_security_settings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `mfa_required` BOOLEAN NOT NULL DEFAULT false,
    `password_history_count` INTEGER NULL,
    `max_failed_login_attempts` INTEGER NULL,
    `account_lockout_minutes` INTEGER NULL,
    `trusted_device_days` INTEGER NULL,
    `notify_on_new_device_login` BOOLEAN NOT NULL DEFAULT true,
    `block_suspicious_logins` BOOLEAN NOT NULL DEFAULT false,
    `local_auth_enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_security_settings_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_configurations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_configurations_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campus_configurations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `campus_configurations_campus_id_key`(`campus_id`),
    INDEX `campus_configurations_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_security_settings` (
    `id` VARCHAR(512) NOT NULL,
    `mfa_globally_enabled` BOOLEAN NOT NULL DEFAULT true,
    `mfa_required_for_platform_admins` BOOLEAN NOT NULL DEFAULT false,
    `default_max_failed_login_attempts` INTEGER NOT NULL DEFAULT 5,
    `default_account_lockout_minutes` INTEGER NOT NULL DEFAULT 15,
    `default_password_history_count` INTEGER NOT NULL DEFAULT 5,
    `default_trusted_device_days` INTEGER NOT NULL DEFAULT 30,
    `suspicious_login_detection_enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campuses` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `address_line` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `campuses_tenant_id_idx`(`tenant_id`),
    INDEX `campuses_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `campuses_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `departments_tenant_id_idx`(`tenant_id`),
    INDEX `departments_campus_id_idx`(`campus_id`),
    INDEX `departments_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `departments_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `programs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `degree_level` TEXT NULL,
    `duration_years` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `programs_tenant_id_idx`(`tenant_id`),
    INDEX `programs_department_id_idx`(`department_id`),
    INDEX `programs_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `programs_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_years` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `academic_years_tenant_id_idx`(`tenant_id`),
    INDEX `academic_years_tenant_id_is_current_idx`(`tenant_id`, `is_current`),
    INDEX `academic_years_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `academic_years_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terms` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 1,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `terms_tenant_id_idx`(`tenant_id`),
    INDEX `terms_academic_year_id_idx`(`academic_year_id`),
    INDEX `terms_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `terms_academic_year_id_code_key`(`academic_year_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `building_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `room_type` ENUM('CLASSROOM', 'LABORATORY', 'SEMINAR_HALL', 'AUDITORIUM', 'LIBRARY', 'OFFICE', 'OTHER') NOT NULL DEFAULT 'CLASSROOM',
    `capacity` INTEGER NULL,
    `building_name` TEXT NULL,
    `floor` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `rooms_tenant_id_idx`(`tenant_id`),
    INDEX `rooms_campus_id_idx`(`campus_id`),
    INDEX `rooms_building_id_idx`(`building_id`),
    INDEX `rooms_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `rooms_campus_id_code_key`(`campus_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `buildings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `address_line` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `buildings_tenant_id_idx`(`tenant_id`),
    INDEX `buildings_campus_id_idx`(`campus_id`),
    INDEX `buildings_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `buildings_tenant_id_campus_id_code_key`(`tenant_id`, `campus_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `batches` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `batches_tenant_id_idx`(`tenant_id`),
    INDEX `batches_program_id_idx`(`program_id`),
    INDEX `batches_academic_year_id_idx`(`academic_year_id`),
    INDEX `batches_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `batches_tenant_id_program_id_code_key`(`tenant_id`, `program_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sections` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `capacity` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `sections_tenant_id_idx`(`tenant_id`),
    INDEX `sections_program_id_idx`(`program_id`),
    INDEX `sections_academic_year_id_idx`(`academic_year_id`),
    INDEX `sections_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `sections_tenant_id_program_id_code_key`(`tenant_id`, `program_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `recipient_user_id` CHAR(36) NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP', 'PUSH') NOT NULL,
    `subject` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `template_id` CHAR(36) NULL,
    `campaign_id` CHAR(36) NULL,
    `variables` JSON NULL,
    `scheduled_at` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'QUEUED', 'SENT', 'SUPPRESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` TEXT NULL,
    `provider` TEXT NULL,
    `provider_message_id` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `read_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_tenant_id_idx`(`tenant_id`),
    INDEX `notifications_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `notifications_tenant_id_channel_idx`(`tenant_id`, `channel`),
    INDEX `notifications_tenant_id_campaign_id_idx`(`tenant_id`, `campaign_id`),
    INDEX `notifications_recipient_user_id_idx`(`recipient_user_id`),
    INDEX `notifications_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `notifications_recipient_user_id_created_at_idx`(`recipient_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP', 'PUSH') NOT NULL,
    `subject_template` TEXT NOT NULL,
    `body_template` TEXT NOT NULL,
    `variables` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `notification_templates_tenant_id_channel_idx`(`tenant_id`, `channel`),
    INDEX `notification_templates_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    INDEX `notification_templates_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `notification_templates_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_campaigns` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `template_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELED', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `audience_filter` JSON NOT NULL,
    `audience_count` INTEGER NULL,
    `scheduled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `canceled_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `notification_campaigns_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `notification_campaigns_tenant_id_template_id_idx`(`tenant_id`, `template_id`),
    INDEX `notification_campaigns_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_delivery_logs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `notification_id` CHAR(36) NOT NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP', 'PUSH') NOT NULL,
    `provider` TEXT NOT NULL,
    `status` ENUM('SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED') NOT NULL,
    `provider_message_id` TEXT NULL,
    `request` JSON NULL,
    `response` JSON NULL,
    `error` TEXT NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_delivery_logs_tenant_id_notification_id_idx`(`tenant_id`, `notification_id`),
    INDEX `notification_delivery_logs_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_provider_configs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP', 'PUSH') NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `name` TEXT NULL,
    `config` JSON NULL,
    `credentials_encrypted` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_provider_configs_tenant_id_channel_is_active_idx`(`tenant_id`, `channel`, `is_active`),
    UNIQUE INDEX `notification_provider_configs_tenant_id_channel_provider_key`(`tenant_id`, `channel`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_event_triggers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `event_key` VARCHAR(191) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_event_triggers_tenant_id_event_key_idx`(`tenant_id`, `event_key`),
    UNIQUE INDEX `notification_event_triggers_tenant_id_event_key_template_id_key`(`tenant_id`, `event_key`, `template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP', 'PUSH') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_preferences_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `notification_preferences_tenant_id_user_id_channel_key`(`tenant_id`, `user_id`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_push_devices` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_token` VARCHAR(191) NOT NULL,
    `platform` TEXT NOT NULL,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_push_devices_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `user_push_devices_tenant_id_user_id_device_token_key`(`tenant_id`, `user_id`, `device_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_types` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `allowed_mime_types` JSON NULL,
    `allowed_extensions` JSON NULL,
    `max_size_bytes` INTEGER NULL,
    `is_sensitive` BOOLEAN NOT NULL DEFAULT false,
    `can_expire` BOOLEAN NOT NULL DEFAULT false,
    `retention_days` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `document_types_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `document_types_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `document_type_id` CHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL DEFAULT '',
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING_UPLOAD', 'UPLOADED', 'AWAITING_SCAN', 'READY', 'VERIFIED', 'REJECTED', 'REPLACED', 'EXPIRED', 'QUARANTINED') NOT NULL DEFAULT 'PENDING_UPLOAD',
    `metadata` JSON NULL,
    `tags` JSON NOT NULL,
    `current_version_id` CHAR(36) NULL,
    `storage_key` VARCHAR(512) NULL,
    `original_filename` TEXT NULL,
    `mime_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `expires_at` DATETIME(3) NULL,
    `expired_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `verified_at` DATETIME(3) NULL,
    `verification_note` TEXT NULL,
    `rejected_by` CHAR(36) NULL,
    `rejected_at` DATETIME(3) NULL,
    `rejection_reason` TEXT NULL,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `documents_storage_key_key`(`storage_key`),
    INDEX `documents_tenant_id_idx`(`tenant_id`),
    INDEX `documents_tenant_id_category_idx`(`tenant_id`, `category`),
    INDEX `documents_tenant_id_document_type_id_idx`(`tenant_id`, `document_type_id`),
    INDEX `documents_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `documents_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_versions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `version_number` INTEGER NOT NULL,
    `storage_key` VARCHAR(512) NOT NULL,
    `original_filename` TEXT NOT NULL,
    `mime_type` TEXT NOT NULL,
    `size_bytes` INTEGER NULL,
    `sha256` TEXT NULL,
    `scan_status` ENUM('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'ERROR', 'QUARANTINED') NOT NULL DEFAULT 'PENDING',
    `scan_engine` TEXT NULL,
    `scan_error` TEXT NULL,
    `scanned_at` DATETIME(3) NULL,
    `uploaded_by` CHAR(36) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `replaced_by_version_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `document_versions_storage_key_key`(`storage_key`),
    INDEX `document_versions_tenant_id_idx`(`tenant_id`),
    INDEX `document_versions_document_id_idx`(`document_id`),
    UNIQUE INDEX `document_versions_document_id_version_number_key`(`document_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_access_grants` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `grantee_type` ENUM('USER', 'ROLE') NOT NULL DEFAULT 'USER',
    `grantee_user_id` CHAR(36) NULL,
    `grantee_role_id` VARCHAR(191) NULL,
    `can_view` BOOLEAN NOT NULL DEFAULT true,
    `can_download` BOOLEAN NOT NULL DEFAULT true,
    `granted_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_access_grants_tenant_id_idx`(`tenant_id`),
    INDEX `document_access_grants_document_id_idx`(`document_id`),
    INDEX `document_access_grants_grantee_user_id_idx`(`grantee_user_id`),
    INDEX `document_access_grants_grantee_role_id_idx`(`grantee_role_id`),
    UNIQUE INDEX `document_access_grants_document_id_grantee_type_grantee_user_key`(`document_id`, `grantee_type`, `grantee_user_id`, `grantee_role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_download_logs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `version_id` CHAR(36) NULL,
    `downloaded_by` CHAR(36) NULL,
    `ip_address` TEXT NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_download_logs_tenant_id_document_id_idx`(`tenant_id`, `document_id`),
    INDEX `document_download_logs_document_id_created_at_idx`(`document_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_definitions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `workflow_definitions_tenant_id_idx`(`tenant_id`),
    INDEX `workflow_definitions_tenant_id_entity_type_is_active_idx`(`tenant_id`, `entity_type`, `is_active`),
    UNIQUE INDEX `workflow_definitions_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_states` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `category` ENUM('INITIAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    `allows_resubmission` BOOLEAN NOT NULL DEFAULT false,
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_states_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `workflow_states_definition_id_code_key`(`definition_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_transitions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `from_state_id` CHAR(36) NOT NULL,
    `to_state_id` CHAR(36) NOT NULL,
    `action` ENUM('SUBMIT', 'APPROVE', 'REJECT', 'RESUBMIT', 'ESCALATE', 'CANCEL') NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `condition_expression` JSON NULL,
    `approval_mode` ENUM('NONE', 'SEQUENTIAL', 'PARALLEL') NOT NULL DEFAULT 'NONE',
    `parallel_rule` ENUM('ALL', 'ANY', 'QUORUM') NULL,
    `parallel_quorum_count` INTEGER NULL,
    `deadline_hours` INTEGER NULL,
    `escalation_role_code` TEXT NULL,
    `escalation_after_hours` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_transitions_tenant_id_idx`(`tenant_id`),
    INDEX `workflow_transitions_from_state_id_idx`(`from_state_id`),
    UNIQUE INDEX `workflow_transitions_definition_id_code_key`(`definition_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_transition_approvers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `transition_id` CHAR(36) NOT NULL,
    `approver_type` ENUM('ROLE', 'SPECIFIC_USER') NOT NULL,
    `role_code` TEXT NULL,
    `specific_user_id` CHAR(36) NULL,
    `scope_field` TEXT NULL,
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_transition_approvers_tenant_id_idx`(`tenant_id`),
    INDEX `workflow_transition_approvers_transition_id_idx`(`transition_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_instances` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NOT NULL,
    `current_state_id` CHAR(36) NOT NULL,
    `status` ENUM('IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    `context` JSON NULL,
    `started_by` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_instances_tenant_id_idx`(`tenant_id`),
    INDEX `workflow_instances_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `workflow_instances_definition_id_idx`(`definition_id`),
    UNIQUE INDEX `workflow_instances_tenant_id_entity_type_entity_id_key`(`tenant_id`, `entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_approval_tasks` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `instance_id` CHAR(36) NOT NULL,
    `transition_id` CHAR(36) NOT NULL,
    `approver_slot_id` CHAR(36) NULL,
    `assigned_user_id` CHAR(36) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'EXPIRED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `due_at` DATETIME(3) NULL,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `escalated_at` DATETIME(3) NULL,
    `escalated_to_role_code` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_approval_tasks_tenant_id_idx`(`tenant_id`),
    INDEX `workflow_approval_tasks_instance_id_idx`(`instance_id`),
    INDEX `workflow_approval_tasks_status_due_at_idx`(`status`, `due_at`),
    INDEX `workflow_approval_tasks_assigned_user_id_status_idx`(`assigned_user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `admission_number` VARCHAR(191) NOT NULL,
    `roll_number` TEXT NULL,
    `registration_number` TEXT NULL,
    `id_card_token` VARCHAR(512) NULL,
    `first_name` TEXT NOT NULL,
    `middle_name` TEXT NULL,
    `last_name` TEXT NOT NULL,
    `full_name` TEXT NOT NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED') NOT NULL DEFAULT 'NOT_SPECIFIED',
    `blood_group` ENUM('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `date_of_birth` DATETIME(3) NULL,
    `nationality` VARCHAR(255) NULL DEFAULT 'Indian',
    `category` TEXT NULL,
    `email` TEXT NULL,
    `alternate_email` TEXT NULL,
    `primary_phone` TEXT NULL,
    `alternate_phone` TEXT NULL,
    `current_address_line_1` TEXT NULL,
    `current_address_line_2` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `postal_code` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `permanent_address_line_1` TEXT NULL,
    `permanent_address_line_2` TEXT NULL,
    `permanent_city` TEXT NULL,
    `permanent_state` TEXT NULL,
    `permanent_postal_code` TEXT NULL,
    `permanent_country` VARCHAR(255) NULL DEFAULT 'India',
    `profile_photo_key` TEXT NULL,
    `status` ENUM('APPLICANT', 'ADMITTED', 'PROVISIONAL', 'ENROLLED', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'ALUMNI') NOT NULL DEFAULT 'APPLICANT',
    `program_id` CHAR(36) NULL,
    `batch_id` CHAR(36) NULL,
    `section_id` CHAR(36) NULL,
    `academic_year_id` CHAR(36) NULL,
    `admitted_on` DATETIME(3) NULL,
    `year_of_admission` INTEGER NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `students_id_card_token_key`(`id_card_token`),
    INDEX `students_tenant_id_idx`(`tenant_id`),
    INDEX `students_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    INDEX `students_campus_id_idx`(`campus_id`),
    INDEX `students_program_id_idx`(`program_id`),
    INDEX `students_batch_id_idx`(`batch_id`),
    INDEX `students_section_id_idx`(`section_id`),
    INDEX `students_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `students_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `students_tenant_id_campus_id_status_idx`(`tenant_id`, `campus_id`, `status`),
    UNIQUE INDEX `students_tenant_id_admission_number_key`(`tenant_id`, `admission_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardians` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `name` TEXT NOT NULL,
    `kind` ENUM('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER') NOT NULL,
    `role` ENUM('PRIMARY', 'SECONDARY', 'EMERGENCY') NOT NULL DEFAULT 'PRIMARY',
    `phone` TEXT NULL,
    `email` TEXT NULL,
    `occupation` TEXT NULL,
    `monthly_income_cents` INTEGER NULL,
    `address` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `guardians_tenant_id_idx`(`tenant_id`),
    INDEX `guardians_student_id_idx`(`student_id`),
    INDEX `guardians_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `category` TEXT NOT NULL,
    `document_name` TEXT NOT NULL,
    `storage_key` TEXT NULL,
    `original_filename` TEXT NULL,
    `mime_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `verified_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_documents_tenant_id_idx`(`tenant_id`),
    INDEX `student_documents_student_id_idx`(`student_id`),
    INDEX `student_documents_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_admissions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `application_number` VARCHAR(191) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NULL,
    `applied_at` DATETIME(3) NOT NULL,
    `status` ENUM('APPLIED', 'DOCUMENTS_VERIFIED', 'OFFERED', 'ACCEPTED', 'ENROLLED', 'CANCELLED', 'REJECTED') NOT NULL DEFAULT 'APPLIED',
    `mode` TEXT NULL,
    `offer_letter_key` TEXT NULL,
    `admission_fee_cents` INTEGER NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_admissions_tenant_id_idx`(`tenant_id`),
    INDEX `student_admissions_student_id_idx`(`student_id`),
    INDEX `student_admissions_program_id_idx`(`program_id`),
    UNIQUE INDEX `student_admissions_tenant_id_application_number_key`(`tenant_id`, `application_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_academic_records` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `institution` TEXT NOT NULL,
    `board` TEXT NULL,
    `degree` TEXT NULL,
    `year_of_passing` INTEGER NULL,
    `percentage` DOUBLE NULL,
    `gpa` DOUBLE NULL,
    `grade` TEXT NULL,
    `marks_obtained` INTEGER NULL,
    `marks_out_of` INTEGER NULL,
    `rank` TEXT NULL,
    `is_highest_qualification` BOOLEAN NOT NULL DEFAULT false,
    `verification_status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_academic_records_tenant_id_idx`(`tenant_id`),
    INDEX `student_academic_records_student_id_idx`(`student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_enrollments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `program_id` CHAR(36) NOT NULL,
    `section_id` CHAR(36) NULL,
    `batch_id` CHAR(36) NULL,
    `roll_number` TEXT NULL,
    `semester` INTEGER NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'WITHDRAWN', 'ON_HOLD', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `enrolled_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_enrollments_tenant_id_idx`(`tenant_id`),
    INDEX `student_enrollments_student_id_idx`(`student_id`),
    INDEX `student_enrollments_academic_year_id_idx`(`academic_year_id`),
    INDEX `student_enrollments_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `student_enrollments_tenant_id_student_id_academic_year_id_pr_key`(`tenant_id`, `student_id`, `academic_year_id`, `program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_attendance` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NULL,
    `date` DATETIME(3) NOT NULL,
    `attendance_type` VARCHAR(255) NOT NULL DEFAULT 'CLASS',
    `term_id` CHAR(36) NULL,
    `subject_code` TEXT NULL,
    `subject_name` TEXT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE') NOT NULL DEFAULT 'PRESENT',
    `mark_method` VARCHAR(255) NOT NULL DEFAULT 'MANUAL',
    `sign_in_at` DATETIME(3) NULL,
    `marked_by_user_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_attendance_tenant_id_idx`(`tenant_id`),
    INDEX `student_attendance_student_id_idx`(`student_id`),
    INDEX `student_attendance_student_id_date_idx`(`student_id`, `date`),
    INDEX `student_attendance_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_attendance_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `student_attendance_tenant_id_date_idx`(`tenant_id`, `date`),
    INDEX `student_attendance_tenant_id_date_status_idx`(`tenant_id`, `date`, `status`),
    UNIQUE INDEX `student_attendance_tenant_id_session_id_student_id_key`(`tenant_id`, `session_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_sessions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `course_offering_id` CHAR(36) NULL,
    `section_id` CHAR(36) NULL,
    `timetable_entry_id` CHAR(36) NULL,
    `date` DATETIME(3) NOT NULL,
    `start_time` TEXT NULL,
    `end_time` TEXT NULL,
    `attendance_type` VARCHAR(255) NOT NULL DEFAULT 'CLASS',
    `subject_code` TEXT NULL,
    `subject_name` TEXT NULL,
    `title` TEXT NULL,
    `notes` TEXT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `marked_by_user_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    `closed_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `attendance_sessions_tenant_id_idx`(`tenant_id`),
    INDEX `attendance_sessions_tenant_id_date_idx`(`tenant_id`, `date`),
    INDEX `attendance_sessions_tenant_id_term_id_idx`(`tenant_id`, `term_id`),
    INDEX `attendance_sessions_tenant_id_course_offering_id_idx`(`tenant_id`, `course_offering_id`),
    INDEX `attendance_sessions_tenant_id_section_id_date_idx`(`tenant_id`, `section_id`, `date`),
    INDEX `attendance_sessions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `attendance_sessions_tenant_id_timetable_entry_id_idx`(`tenant_id`, `timetable_entry_id`),
    INDEX `attendance_sessions_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_correction_requests` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NULL,
    `attendance_record_id` CHAR(36) NULL,
    `from_status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE') NOT NULL,
    `to_status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE') NOT NULL,
    `reason` TEXT NOT NULL,
    `remarks` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requested_by_user_id` CHAR(36) NULL,
    `decided_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_correction_requests_tenant_id_idx`(`tenant_id`),
    INDEX `attendance_correction_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `attendance_correction_requests_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `attendance_correction_requests_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_attendance` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `check_in_at` DATETIME(3) NULL,
    `check_out_at` DATETIME(3) NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE') NOT NULL DEFAULT 'PRESENT',
    `session_id` CHAR(36) NULL,
    `mark_method` VARCHAR(255) NOT NULL DEFAULT 'MANUAL',
    `remarks` TEXT NULL,
    `marked_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `faculty_attendance_tenant_id_idx`(`tenant_id`),
    INDEX `faculty_attendance_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    INDEX `faculty_attendance_tenant_id_date_idx`(`tenant_id`, `date`),
    UNIQUE INDEX `faculty_attendance_tenant_id_user_id_date_key`(`tenant_id`, `user_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_devices` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `device_type` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(255) NOT NULL DEFAULT 'Generic',
    `model` TEXT NULL,
    `protocol` VARCHAR(255) NOT NULL DEFAULT 'HTTP_PUSH',
    `ip_address` TEXT NULL,
    `port` INTEGER NULL,
    `endpoint_url` TEXT NULL,
    `serial_number` TEXT NULL,
    `location` TEXT NULL,
    `room_id` CHAR(36) NULL,
    `auth_token_encrypted` TEXT NULL,
    `comm_key_encrypted` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `last_seen_at` DATETIME(3) NULL,
    `last_sync_at` DATETIME(3) NULL,
    `last_sync_status` TEXT NULL,
    `last_sync_message` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `attendance_devices_tenant_id_idx`(`tenant_id`),
    INDEX `attendance_devices_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `attendance_devices_tenant_id_device_type_idx`(`tenant_id`, `device_type`),
    INDEX `attendance_devices_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `attendance_devices_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_device_users` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `external_person_id` VARCHAR(191) NOT NULL,
    `mapped_type` TEXT NOT NULL,
    `student_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `label` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_device_users_tenant_id_idx`(`tenant_id`),
    INDEX `attendance_device_users_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `attendance_device_users_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `attendance_device_users_tenant_id_device_id_external_person__key`(`tenant_id`, `device_id`, `external_person_id`),
    UNIQUE INDEX `attendance_device_users_tenant_id_device_id_student_id_key`(`tenant_id`, `device_id`, `student_id`),
    UNIQUE INDEX `attendance_device_users_tenant_id_device_id_user_id_key`(`tenant_id`, `device_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_device_logs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `event_type` TEXT NOT NULL,
    `external_person_id` TEXT NULL,
    `student_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `captured_at` DATETIME(3) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ingest_source` VARCHAR(255) NOT NULL DEFAULT 'API',
    `dedupe_key` VARCHAR(191) NULL,
    `raw_payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `processing_note` TEXT NULL,
    `session_id` CHAR(36) NULL,
    `applied_record_id` TEXT NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attendance_device_logs_tenant_id_idx`(`tenant_id`),
    INDEX `attendance_device_logs_tenant_id_device_id_idx`(`tenant_id`, `device_id`),
    INDEX `attendance_device_logs_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `attendance_device_logs_tenant_id_captured_at_idx`(`tenant_id`, `captured_at`),
    INDEX `attendance_device_logs_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    UNIQUE INDEX `attendance_device_logs_tenant_id_dedupe_key_key`(`tenant_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_fees` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `structure_id` CHAR(36) NULL,
    `structure_line_id` CHAR(36) NULL,
    `demand_id` CHAR(36) NULL,
    `installment_index` INTEGER NOT NULL DEFAULT 0,
    `hostel_booking_id` CHAR(36) NULL,
    `transport_pass_id` CHAR(36) NULL,
    `head_code` TEXT NOT NULL,
    `head_name` TEXT NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `paid_cents` INTEGER NOT NULL DEFAULT 0,
    `waived_cents` INTEGER NOT NULL DEFAULT 0,
    `late_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `last_late_fee_accrued_at` DATETIME(3) NULL,
    `status` ENUM('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED') NOT NULL DEFAULT 'ISSUED',
    `due_date` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_fees_tenant_id_idx`(`tenant_id`),
    INDEX `student_fees_student_id_idx`(`student_id`),
    INDEX `student_fees_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_fees_student_id_status_idx`(`student_id`, `status`),
    INDEX `student_fees_tenant_id_demand_id_idx`(`tenant_id`, `demand_id`),
    INDEX `student_fees_tenant_id_structure_id_idx`(`tenant_id`, `structure_id`),
    INDEX `student_fees_tenant_id_due_date_status_idx`(`tenant_id`, `due_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_payments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `student_fee_id` CHAR(36) NULL,
    `receipt_number` VARCHAR(191) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `payment_date` DATETIME(3) NOT NULL,
    `method` ENUM('CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE') NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'SUCCEEDED',
    `reference_number` TEXT NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `recorded_by_user_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_payments_tenant_id_idx`(`tenant_id`),
    INDEX `student_payments_student_id_idx`(`student_id`),
    INDEX `student_payments_student_fee_id_idx`(`student_fee_id`),
    INDEX `student_payments_tenant_id_payment_date_idx`(`tenant_id`, `payment_date`),
    INDEX `student_payments_tenant_id_payment_date_status_idx`(`tenant_id`, `payment_date`, `status`),
    UNIQUE INDEX `student_payments_tenant_id_receipt_number_key`(`tenant_id`, `receipt_number`),
    UNIQUE INDEX `student_payments_tenant_id_idempotency_key_key`(`tenant_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_fee_allocations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `student_fee_id` CHAR(36) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_fee_allocations_tenant_id_idx`(`tenant_id`),
    INDEX `student_fee_allocations_tenant_id_student_fee_id_idx`(`tenant_id`, `student_fee_id`),
    INDEX `student_fee_allocations_tenant_id_payment_id_idx`(`tenant_id`, `payment_id`),
    UNIQUE INDEX `student_fee_allocations_payment_id_student_fee_id_key`(`payment_id`, `student_fee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_sessions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `exam_type` ENUM('MID_TERM', 'END_TERM', 'UNIT_TEST', 'PRACTICAL', 'VIVA', 'ANNUAL', 'SUPPLEMENTARY', 'OTHER') NOT NULL,
    `is_supplementary` BOOLEAN NOT NULL DEFAULT false,
    `base_session_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `result_declaration_date` DATETIME(3) NULL,
    `eligibility_policy` TEXT NULL,
    `result_published_at` DATETIME(3) NULL,
    `result_published_by` CHAR(36) NULL,
    `grading_scheme_id` CHAR(36) NULL,
    `grace_policy` JSON NULL,
    `results_locked_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `exam_sessions_tenant_id_idx`(`tenant_id`),
    INDEX `exam_sessions_tenant_id_program_id_term_id_idx`(`tenant_id`, `program_id`, `term_id`),
    INDEX `exam_sessions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `exam_sessions_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `exam_sessions_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_subjects` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `course_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NULL,
    `max_marks` INTEGER NOT NULL,
    `pass_marks` INTEGER NOT NULL,
    `duration_minutes` INTEGER NULL,
    `pattern` TEXT NULL,
    `exam_date` DATETIME(3) NULL,
    `start_time` TEXT NULL,
    `end_time` TEXT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_subjects_tenant_id_idx`(`tenant_id`),
    INDEX `exam_subjects_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `exam_subjects_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `exam_subjects_tenant_id_session_id_course_id_key`(`tenant_id`, `session_id`, `course_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_eligibility_rules` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `rule_type` ENUM('ACTIVE_STUDENT', 'PROGRAM_ENROLLMENT', 'MINIMUM_ATTENDANCE', 'CLEARED_PREREQUISITES', 'OPEN_BACKLOG') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `min_attendance_percent` INTEGER NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_eligibility_rules_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    UNIQUE INDEX `exam_eligibility_rules_tenant_id_session_id_rule_type_key`(`tenant_id`, `session_id`, `rule_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_registrations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `status` ENUM('REGISTERED', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'REGISTERED',
    `registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_registrations_tenant_id_idx`(`tenant_id`),
    INDEX `exam_registrations_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `exam_registrations_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    UNIQUE INDEX `exam_registrations_tenant_id_session_id_student_id_key`(`tenant_id`, `session_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_hall_tickets` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `ticket_number` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ISSUED') NOT NULL DEFAULT 'ISSUED',
    `issued_at` DATETIME(3) NULL,
    `issued_by` TEXT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exam_hall_tickets_registration_id_key`(`registration_id`),
    INDEX `exam_hall_tickets_tenant_id_idx`(`tenant_id`),
    INDEX `exam_hall_tickets_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `exam_hall_tickets_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `exam_hall_tickets_tenant_id_ticket_number_key`(`tenant_id`, `ticket_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_hall_ticket_subjects` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `hall_ticket_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `course_code` TEXT NOT NULL,
    `course_name` TEXT NOT NULL,
    `max_marks` INTEGER NOT NULL,
    `pass_marks` INTEGER NOT NULL,
    `exam_date` DATETIME(3) NULL,
    `start_time` TEXT NULL,
    `end_time` TEXT NULL,
    `room_name` TEXT NULL,
    `seat_no` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exam_hall_ticket_subjects_tenant_id_idx`(`tenant_id`),
    INDEX `exam_hall_ticket_subjects_tenant_id_hall_ticket_id_idx`(`tenant_id`, `hall_ticket_id`),
    UNIQUE INDEX `exam_hall_ticket_subjects_tenant_id_hall_ticket_id_subject_i_key`(`tenant_id`, `hall_ticket_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_seating_plans` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NULL,
    `room_id` CHAR(36) NOT NULL,
    `label` TEXT NULL,
    `capacity` INTEGER NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_seating_plans_tenant_id_idx`(`tenant_id`),
    INDEX `exam_seating_plans_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `exam_seating_plans_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_seat_allocations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `seat_no` VARCHAR(191) NOT NULL,
    `status` ENUM('ALLOCATED', 'PRESENT', 'ABSENT') NOT NULL DEFAULT 'ALLOCATED',
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_seat_allocations_tenant_id_idx`(`tenant_id`),
    INDEX `exam_seat_allocations_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `exam_seat_allocations_tenant_id_plan_id_idx`(`tenant_id`, `plan_id`),
    UNIQUE INDEX `exam_seat_allocations_tenant_id_plan_id_registration_id_key`(`tenant_id`, `plan_id`, `registration_id`),
    UNIQUE INDEX `exam_seat_allocations_tenant_id_plan_id_seat_no_key`(`tenant_id`, `plan_id`, `seat_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_invigilator_assignments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('CHIEF_INVIGILATOR', 'INVIGILATOR') NOT NULL DEFAULT 'INVIGILATOR',
    `room_id` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_invigilator_assignments_tenant_id_idx`(`tenant_id`),
    INDEX `exam_invigilator_assignments_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    INDEX `exam_invigilator_assignments_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    UNIQUE INDEX `exam_invigilator_assignments_tenant_id_subject_id_user_id_key`(`tenant_id`, `subject_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_marks_entries` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `marks_obtained` INTEGER NULL,
    `grace_marks` INTEGER NOT NULL DEFAULT 0,
    `attendance_status` VARCHAR(255) NOT NULL DEFAULT 'PRESENT',
    `status` ENUM('DRAFT', 'SUBMITTED', 'MODERATED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `moderated_by` TEXT NULL,
    `moderated_at` DATETIME(3) NULL,
    `approved_by` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `remark` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_marks_entries_tenant_id_idx`(`tenant_id`),
    INDEX `exam_marks_entries_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    INDEX `exam_marks_entries_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `exam_marks_entries_tenant_id_registration_id_subject_id_key`(`tenant_id`, `registration_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_revaluation_requests` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `marks_entry_id` CHAR(36) NULL,
    `reason` TEXT NOT NULL,
    `requested_by` TEXT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('REQUESTED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `resolved_by` TEXT NULL,
    `resolved_at` DATETIME(3) NULL,
    `revised_marks` INTEGER NULL,
    `remark` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_revaluation_requests_tenant_id_idx`(`tenant_id`),
    INDEX `exam_revaluation_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `exam_revaluation_requests_tenant_id_registration_id_subject__key`(`tenant_id`, `registration_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grading_schemes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `pass_mode` VARCHAR(255) NOT NULL DEFAULT 'PERCENTAGE',
    `min_pass_percent` DOUBLE NULL,
    `min_pass_grade_point` DOUBLE NULL,
    `weighting_mode` VARCHAR(255) NOT NULL DEFAULT 'CREDIT_WEIGHTED',
    `gpa_max` DOUBLE NOT NULL DEFAULT 10,
    `grace_enabled` BOOLEAN NOT NULL DEFAULT false,
    `max_grace_marks` DOUBLE NOT NULL DEFAULT 0,
    `grace_to_pass_diff` DOUBLE NOT NULL DEFAULT 0,
    `rounding_decimals` INTEGER NOT NULL DEFAULT 2,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `grading_schemes_tenant_id_idx`(`tenant_id`),
    INDEX `grading_schemes_tenant_id_is_default_idx`(`tenant_id`, `is_default`),
    UNIQUE INDEX `grading_schemes_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_scales` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `scheme_id` CHAR(36) NOT NULL,
    `grade` VARCHAR(191) NOT NULL,
    `min_percent` DOUBLE NOT NULL,
    `max_percent` DOUBLE NOT NULL,
    `grade_point` DOUBLE NOT NULL,
    `grade_description` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `grade_scales_tenant_id_scheme_id_idx`(`tenant_id`, `scheme_id`),
    UNIQUE INDEX `grade_scales_tenant_id_scheme_id_grade_key`(`tenant_id`, `scheme_id`, `grade`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_components` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `kind` VARCHAR(255) NOT NULL DEFAULT 'THEORY',
    `weightage` DOUBLE NOT NULL,
    `max_marks` DOUBLE NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assessment_components_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `assessment_components_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    UNIQUE INDEX `assessment_components_tenant_id_session_id_subject_id_code_key`(`tenant_id`, `session_id`, `subject_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_component_marks` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `marks_obtained` DOUBLE NOT NULL,
    `remark` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `exam_component_marks_tenant_id_component_id_idx`(`tenant_id`, `component_id`),
    INDEX `exam_component_marks_tenant_id_registration_id_idx`(`tenant_id`, `registration_id`),
    INDEX `exam_component_marks_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    UNIQUE INDEX `exam_component_marks_tenant_id_registration_id_subject_id_co_key`(`tenant_id`, `registration_id`, `subject_id`, `component_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `result_calculations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NULL,
    `subject_id` CHAR(36) NOT NULL,
    `marks_entry_id` CHAR(36) NULL,
    `exam_id` CHAR(36) NULL,
    `process_id` CHAR(36) NULL,
    `raw_marks` DOUBLE NULL,
    `grace_applied` DOUBLE NOT NULL DEFAULT 0,
    `effective_marks` DOUBLE NULL,
    `max_marks` INTEGER NOT NULL,
    `pass_marks` INTEGER NOT NULL,
    `percentage` DOUBLE NULL,
    `grade` TEXT NULL,
    `grade_point` DOUBLE NULL,
    `outcome` ENUM('PASS', 'FAIL', 'PASS_WITH_GRACE', 'INCOMPLETE') NOT NULL DEFAULT 'INCOMPLETE',
    `component_json` JSON NULL,
    `schema_json` JSON NULL,
    `calculated_at` DATETIME(3) NULL,
    `calculated_by` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `result_calculations_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `result_calculations_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `result_calculations_tenant_id_subject_id_idx`(`tenant_id`, `subject_id`),
    INDEX `result_calculations_tenant_id_process_id_idx`(`tenant_id`, `process_id`),
    INDEX `result_calculations_tenant_id_outcome_idx`(`tenant_id`, `outcome`),
    UNIQUE INDEX `result_calculations_tenant_id_session_id_student_id_subject__key`(`tenant_id`, `session_id`, `student_id`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `result_processes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `exam_id` CHAR(36) NULL,
    `state` ENUM('CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED') NOT NULL DEFAULT 'CALCULATED',
    `standing` ENUM('PASSED', 'FAILED', 'SUPPLEMENTARY') NULL,
    `subject_count` INTEGER NULL,
    `passed_count` INTEGER NULL,
    `failed_count` INTEGER NULL,
    `total_raw_marks` DOUBLE NULL,
    `total_grace_marks` DOUBLE NULL,
    `total_effective_marks` DOUBLE NULL,
    `total_max_marks` INTEGER NULL,
    `aggregate_percent` DOUBLE NULL,
    `credits_attempted` INTEGER NULL,
    `credits_earned` INTEGER NULL,
    `gpa` DOUBLE NULL,
    `cgpa` DOUBLE NULL,
    `calculation_version` INTEGER NOT NULL DEFAULT 1,
    `calculated_at` DATETIME(3) NULL,
    `calculated_by` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `approved_by` TEXT NULL,
    `published_at` DATETIME(3) NULL,
    `published_by` TEXT NULL,
    `locked_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `result_processes_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `result_processes_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `result_processes_tenant_id_state_idx`(`tenant_id`, `state`),
    UNIQUE INDEX `result_processes_tenant_id_session_id_student_id_key`(`tenant_id`, `session_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `result_history` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `process_id` CHAR(36) NULL,
    `student_id` CHAR(36) NULL,
    `event` TEXT NOT NULL,
    `fromState` ENUM('CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED') NULL,
    `toState` ENUM('CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED') NULL,
    `details` JSON NULL,
    `actor_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `result_history_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `result_history_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `result_history_tenant_id_process_id_idx`(`tenant_id`, `process_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_heads` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `frequency` ENUM('ONE_TIME', 'PER_TERM', 'ANNUAL') NOT NULL,
    `default_amount_cents` INTEGER NOT NULL,
    `is_optional` BOOLEAN NOT NULL DEFAULT false,
    `is_refundable` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_heads_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    INDEX `fee_heads_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `fee_heads_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structures` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `academic_year_id` CHAR(36) NULL,
    `term_id` CHAR(36) NULL,
    `program_id` CHAR(36) NULL,
    `section_id` CHAR(36) NULL,
    `installment_count` INTEGER NOT NULL DEFAULT 1,
    `due_day_offset` INTEGER NOT NULL DEFAULT 30,
    `installment_gap_days` INTEGER NOT NULL DEFAULT 0,
    `late_fee_percent_bps` INTEGER NOT NULL DEFAULT 0,
    `late_fee_flat_cents` INTEGER NOT NULL DEFAULT 0,
    `late_fee_grace_days` INTEGER NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `fee_structures_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `fee_structures_tenant_id_academic_year_id_idx`(`tenant_id`, `academic_year_id`),
    INDEX `fee_structures_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structure_lines` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `head_id` CHAR(36) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_structure_lines_tenant_id_structure_id_idx`(`tenant_id`, `structure_id`),
    INDEX `fee_structure_lines_tenant_id_head_id_idx`(`tenant_id`, `head_id`),
    UNIQUE INDEX `fee_structure_lines_structure_id_head_id_key`(`structure_id`, `head_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_fee_assignments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `effective_date` DATE NOT NULL DEFAULT (CURRENT_DATE),
    `notes` TEXT NULL,
    `assigned_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_fee_assignments_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `student_fee_assignments_tenant_id_structure_id_idx`(`tenant_id`, `structure_id`),
    INDEX `student_fee_assignments_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_fee_assignments_tenant_id_term_id_idx`(`tenant_id`, `term_id`),
    UNIQUE INDEX `student_fee_assignments_tenant_id_student_id_structure_id_te_key`(`tenant_id`, `student_id`, `structure_id`, `term_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_demands` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `assignment_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `demand_number` VARCHAR(191) NOT NULL,
    `installment_index` INTEGER NOT NULL DEFAULT 1,
    `issue_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `status` ENUM('ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED') NOT NULL DEFAULT 'ISSUED',
    `total_cents` INTEGER NOT NULL,
    `paid_cents` INTEGER NOT NULL DEFAULT 0,
    `waived_cents` INTEGER NOT NULL DEFAULT 0,
    `late_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_demands_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `fee_demands_tenant_id_assignment_id_idx`(`tenant_id`, `assignment_id`),
    INDEX `fee_demands_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `fee_demands_tenant_id_due_date_idx`(`tenant_id`, `due_date`),
    UNIQUE INDEX `fee_demands_tenant_id_demand_number_key`(`tenant_id`, `demand_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_concessions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `demand_id` CHAR(36) NULL,
    `student_fee_id` CHAR(36) NULL,
    `head_id` CHAR(36) NULL,
    `kind` ENUM('SCHOLARSHIP', 'CONCESSION', 'WAIVER') NOT NULL,
    `basis` ENUM('FLAT', 'PERCENT') NOT NULL,
    `percent_bps` INTEGER NULL,
    `amount_cents` INTEGER NULL,
    `applied_cents` INTEGER NOT NULL DEFAULT 0,
    `distribution` JSON NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `requested_by` TEXT NULL,
    `decided_by` TEXT NULL,
    `decided_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_concessions_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `fee_concessions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `fee_concessions_tenant_id_demand_id_idx`(`tenant_id`, `demand_id`),
    INDEX `fee_concessions_tenant_id_student_fee_id_idx`(`tenant_id`, `student_fee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_refunds` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `refund_number` VARCHAR(191) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `method` ENUM('CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE') NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `requested_by` TEXT NULL,
    `approved_by` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `processed_by` TEXT NULL,
    `processed_at` DATETIME(3) NULL,
    `rejection_reason` TEXT NULL,
    `reference_number` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fee_refunds_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `fee_refunds_tenant_id_payment_id_idx`(`tenant_id`, `payment_id`),
    INDEX `fee_refunds_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `fee_refunds_tenant_id_refund_number_key`(`tenant_id`, `refund_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_sequences` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` ENUM('RECEIPT', 'DEMAND', 'REFUND') NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fee_sequences_tenant_id_kind_prefix_key`(`tenant_id`, `kind`, `prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_exams` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `exam_type` ENUM('MID_TERM', 'END_TERM', 'UNIT_TEST', 'PRACTICAL', 'VIVA', 'ANNUAL', 'SUPPLEMENTARY', 'OTHER') NOT NULL,
    `term_id` CHAR(36) NULL,
    `program_id` CHAR(36) NULL,
    `section_id` CHAR(36) NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'SCHEDULED',
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `session_id` CHAR(36) NULL,

    INDEX `student_exams_tenant_id_idx`(`tenant_id`),
    INDEX `student_exams_student_id_idx`(`student_id`),
    INDEX `student_exams_program_id_idx`(`program_id`),
    UNIQUE INDEX `student_exams_tenant_id_student_id_session_id_key`(`tenant_id`, `student_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_results` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `exam_id` CHAR(36) NULL,
    `subject_code` TEXT NOT NULL,
    `subject_name` TEXT NOT NULL,
    `max_marks` INTEGER NOT NULL,
    `obtained_marks` INTEGER NULL,
    `grade` TEXT NULL,
    `grade_point` DOUBLE NULL,
    `percentage` DOUBLE NULL,
    `grace_applied` DOUBLE NOT NULL DEFAULT 0,
    `component_json` JSON NULL,
    `outcome` ENUM('PASS', 'FAIL', 'PASS_WITH_GRACE', 'INCOMPLETE') NOT NULL DEFAULT 'INCOMPLETE',
    `published_at` DATETIME(3) NULL,
    `published_by` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `result_calculation_id` CHAR(36) NULL,

    UNIQUE INDEX `student_results_result_calculation_id_key`(`result_calculation_id`),
    INDEX `student_results_tenant_id_idx`(`tenant_id`),
    INDEX `student_results_student_id_idx`(`student_id`),
    INDEX `student_results_exam_id_idx`(`exam_id`),
    INDEX `student_results_tenant_id_outcome_idx`(`tenant_id`, `outcome`),
    INDEX `student_results_tenant_id_published_at_idx`(`tenant_id`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_certificates` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `certificate_type` ENUM('BONAFIDE', 'PROVISIONAL', 'MIGRATION', 'TRANSCRIPT', 'TRANSFER_CERTIFICATE', 'GRADE_CARD', 'MARKSHEET', 'CHARACTER_CERTIFICATE', 'TESTIMONIAL', 'OTHER') NOT NULL,
    `certificate_number` VARCHAR(191) NULL,
    `title` TEXT NULL,
    `request_date` DATETIME(3) NOT NULL,
    `status` ENUM('REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED', 'REVOKED') NOT NULL DEFAULT 'REQUESTED',
    `template_id` CHAR(36) NULL,
    `qr_token` VARCHAR(512) NULL,
    `content_json` JSON NULL,
    `generated_at` DATETIME(3) NULL,
    `generated_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `issued_at` DATETIME(3) NULL,
    `issued_by_user_id` CHAR(36) NULL,
    `storage_key` TEXT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_user_id` CHAR(36) NULL,
    `revoke_reason` TEXT NULL,
    `reissued_from_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_certificates_qr_token_key`(`qr_token`),
    INDEX `student_certificates_tenant_id_idx`(`tenant_id`),
    INDEX `student_certificates_student_id_idx`(`student_id`),
    INDEX `student_certificates_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_certificates_tenant_id_certificate_type_idx`(`tenant_id`, `certificate_type`),
    UNIQUE INDEX `student_certificates_tenant_id_certificate_number_key`(`tenant_id`, `certificate_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificate_templates` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `certificate_type` ENUM('BONAFIDE', 'PROVISIONAL', 'MIGRATION', 'TRANSCRIPT', 'TRANSFER_CERTIFICATE', 'GRADE_CARD', 'MARKSHEET', 'CHARACTER_CERTIFICATE', 'TESTIMONIAL', 'OTHER') NOT NULL,
    `field_config_json` JSON NULL,
    `branding_json` JSON NULL,
    `numbering_json` JSON NULL,
    `qr_enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `certificate_templates_tenant_id_certificate_type_idx`(`tenant_id`, `certificate_type`),
    UNIQUE INDEX `certificate_templates_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificate_history_rows` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `certificate_id` CHAR(36) NOT NULL,
    `from_status` ENUM('REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED', 'REVOKED') NOT NULL,
    `to_status` ENUM('REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED', 'REVOKED') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `detail_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `certificate_history_rows_tenant_id_certificate_id_idx`(`tenant_id`, `certificate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_library_loans` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `copy_id` CHAR(36) NULL,
    `member_id` CHAR(36) NULL,
    `item_title` TEXT NOT NULL,
    `item_author` TEXT NULL,
    `item_code` TEXT NULL,
    `item_type` TEXT NULL,
    `borrowed_at` DATETIME(3) NOT NULL,
    `due_date` DATETIME(3) NULL,
    `returned_at` DATETIME(3) NULL,
    `status` ENUM('ISSUED', 'RETURNED', 'OVERDUE', 'LOST') NOT NULL DEFAULT 'ISSUED',
    `renewal_count` INTEGER NOT NULL DEFAULT 0,
    `last_renewed_at` DATETIME(3) NULL,
    `return_condition` TEXT NULL,
    `returned_by_id` CHAR(36) NULL,
    `fine_cents` INTEGER NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_library_loans_tenant_id_idx`(`tenant_id`),
    INDEX `student_library_loans_student_id_idx`(`student_id`),
    INDEX `student_library_loans_copy_id_idx`(`copy_id`),
    INDEX `student_library_loans_member_id_idx`(`member_id`),
    INDEX `student_library_loans_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_library_loans_tenant_id_due_date_status_idx`(`tenant_id`, `due_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostels` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `gender_type` ENUM('BOYS', 'GIRLS', 'COED') NOT NULL DEFAULT 'COED',
    `warden_user_id` CHAR(36) NULL,
    `description` TEXT NULL,
    `fee_head_id` CHAR(36) NULL,
    `charge_rent_on_check_in` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostels_tenant_id_idx`(`tenant_id`),
    INDEX `hostels_campus_id_idx`(`campus_id`),
    INDEX `hostels_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hostels_tenant_id_campus_id_code_key`(`tenant_id`, `campus_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_buildings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_buildings_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_buildings_hostel_id_idx`(`hostel_id`),
    INDEX `hostel_buildings_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hostel_buildings_tenant_id_hostel_id_code_key`(`tenant_id`, `hostel_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_floors` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `building_id` CHAR(36) NOT NULL,
    `floor_number` INTEGER NOT NULL,
    `name` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_floors_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_floors_building_id_idx`(`building_id`),
    INDEX `hostel_floors_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hostel_floors_tenant_id_building_id_floor_number_key`(`tenant_id`, `building_id`, `floor_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_rooms` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `floor_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NULL,
    `sharing` ENUM('SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORM') NOT NULL DEFAULT 'SINGLE',
    `bed_capacity` INTEGER NOT NULL DEFAULT 1,
    `monthly_rent_cents` INTEGER NOT NULL DEFAULT 0,
    `has_attached_bath` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_rooms_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_rooms_floor_id_idx`(`floor_id`),
    INDEX `hostel_rooms_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hostel_rooms_tenant_id_floor_id_code_key`(`tenant_id`, `floor_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_beds` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `room_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
    `monthly_rent_cents` INTEGER NULL,
    `notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hostel_beds_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_beds_room_id_idx`(`room_id`),
    INDEX `hostel_beds_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `hostel_beds_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hostel_beds_tenant_id_room_id_code_key`(`tenant_id`, `room_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_wardens` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('WARDEN', 'ASSISTANT') NOT NULL DEFAULT 'WARDEN',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `assigned_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_wardens_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_wardens_hostel_id_idx`(`hostel_id`),
    INDEX `hostel_wardens_user_id_idx`(`user_id`),
    UNIQUE INDEX `hostel_wardens_tenant_id_hostel_id_user_id_role_key`(`tenant_id`, `hostel_id`, `user_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_complaints` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `category` ENUM('MAINTENANCE', 'ELECTRICAL', 'PLUMBING', 'CLEANING', 'INFRASTRUCTURE', 'NOISE', 'FOOD', 'SECURITY', 'OTHER') NOT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `subject` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `assigned_to_user_id` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NULL,
    `resolved_by_user_id` CHAR(36) NULL,
    `resolution_notes` TEXT NULL,
    `resolved_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_complaints_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_complaints_hostel_id_idx`(`hostel_id`),
    INDEX `hostel_complaints_student_id_idx`(`student_id`),
    INDEX `hostel_complaints_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hostel_visitors` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NOT NULL,
    `visitor_name` TEXT NOT NULL,
    `phone` TEXT NULL,
    `email` TEXT NULL,
    `id_proof_type` TEXT NULL,
    `id_proof_number` TEXT NULL,
    `purpose` TEXT NULL,
    `student_id` CHAR(36) NULL,
    `visitor_label` TEXT NULL,
    `check_in_at` DATETIME(3) NOT NULL,
    `check_out_at` DATETIME(3) NULL,
    `status` ENUM('INSIDE', 'EXITED') NOT NULL DEFAULT 'INSIDE',
    `recorded_by_user_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `hostel_visitors_tenant_id_idx`(`tenant_id`),
    INDEX `hostel_visitors_hostel_id_idx`(`hostel_id`),
    INDEX `hostel_visitors_student_id_idx`(`student_id`),
    INDEX `hostel_visitors_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_hostel_bookings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `hostel_id` CHAR(36) NULL,
    `building_id` CHAR(36) NULL,
    `floor_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `bed_id` CHAR(36) NULL,
    `previous_booking_id` CHAR(36) NULL,
    `hostel_name` TEXT NOT NULL,
    `room_number` TEXT NOT NULL,
    `bed_number` TEXT NULL,
    `allocation_date` DATETIME(3) NULL,
    `check_in_date` DATETIME(3) NULL,
    `check_out_date` DATETIME(3) NULL,
    `status` ENUM('REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `monthly_rent_cents` INTEGER NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_hostel_bookings_tenant_id_idx`(`tenant_id`),
    INDEX `student_hostel_bookings_student_id_idx`(`student_id`),
    INDEX `student_hostel_bookings_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_hostel_bookings_hostel_id_idx`(`hostel_id`),
    INDEX `student_hostel_bookings_room_id_idx`(`room_id`),
    INDEX `student_hostel_bookings_bed_id_idx`(`bed_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_transport_passes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `route_id` CHAR(36) NULL,
    `stop_id` CHAR(36) NULL,
    `drop_stop_id` CHAR(36) NULL,
    `vehicle_id` CHAR(36) NULL,
    `driver_id` CHAR(36) NULL,
    `route_code` TEXT NULL,
    `route_name` TEXT NOT NULL,
    `pickup_point` TEXT NULL,
    `drop_point` TEXT NULL,
    `vehicle_number` TEXT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `amount_cents` INTEGER NULL,
    `daily_pickup_time` TEXT NULL,
    `daily_drop_time` TEXT NULL,
    `issued_on` DATETIME(3) NULL,
    `issued_by_user_id` TEXT NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_transport_passes_tenant_id_idx`(`tenant_id`),
    INDEX `student_transport_passes_student_id_idx`(`student_id`),
    INDEX `student_transport_passes_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `student_transport_passes_tenant_id_route_id_idx`(`tenant_id`, `route_id`),
    INDEX `student_transport_passes_tenant_id_vehicle_id_idx`(`tenant_id`, `vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_holds` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `type` ENUM('ACADEMIC', 'FINANCIAL', 'ADMINISTRATIVE', 'DISCIPLINARY', 'MEDICAL', 'OTHER') NOT NULL,
    `reason` TEXT NOT NULL,
    `placed_on` DATETIME(3) NOT NULL,
    `placed_by_user_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'RESOLVED') NOT NULL DEFAULT 'ACTIVE',
    `lifted_on` DATETIME(3) NULL,
    `lifted_by_user_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_holds_tenant_id_idx`(`tenant_id`),
    INDEX `student_holds_student_id_idx`(`student_id`),
    INDEX `student_holds_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_status_history` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `from_status` ENUM('APPLICANT', 'ADMITTED', 'PROVISIONAL', 'ENROLLED', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'ALUMNI') NULL,
    `to_status` ENUM('APPLICANT', 'ADMITTED', 'PROVISIONAL', 'ENROLLED', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'WITHDRAWN', 'GRADUATED', 'ALUMNI') NOT NULL,
    `reason` TEXT NULL,
    `changed_by_user_id` CHAR(36) NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_status_history_tenant_id_idx`(`tenant_id`),
    INDEX `student_status_history_student_id_idx`(`student_id`),
    INDEX `student_status_history_student_id_changed_at_idx`(`student_id`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_communications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `type` ENUM('CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'LETTER', 'OTHER') NOT NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL DEFAULT 'OUTBOUND',
    `subject` TEXT NULL,
    `body` TEXT NOT NULL,
    `sent_at` DATETIME(3) NOT NULL,
    `recipient_type` VARCHAR(255) NOT NULL DEFAULT 'STUDENT',
    `recipient_name` TEXT NULL,
    `recipient_phone` TEXT NULL,
    `recipient_email` TEXT NULL,
    `conducted_by_user_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_communications_tenant_id_idx`(`tenant_id`),
    INDEX `student_communications_student_id_idx`(`student_id`),
    INDEX `student_communications_student_id_sent_at_idx`(`student_id`, `sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_activities` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `event_type` TEXT NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `entity_type` TEXT NULL,
    `entity_id` CHAR(36) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_activities_tenant_id_idx`(`tenant_id`),
    INDEX `student_activities_student_id_idx`(`student_id`),
    INDEX `student_activities_student_id_occurred_at_idx`(`student_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_sessions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `application_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `admission_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `required_documents` JSON NULL,
    `source` VARCHAR(255) NULL DEFAULT 'FRONT_DESK',
    `merit_published_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_sessions_tenant_id_idx`(`tenant_id`),
    INDEX `admission_sessions_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `admission_sessions_academic_year_id_idx`(`academic_year_id`),
    UNIQUE INDEX `admission_sessions_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_program_offers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `seats` INTEGER NOT NULL DEFAULT 0,
    `filled_seats` INTEGER NOT NULL DEFAULT 0,
    `application_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `admission_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `tuition_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `required_documents` JSON NULL,
    `status` ENUM('OPEN', 'CLOSED', 'FULL') NOT NULL DEFAULT 'OPEN',
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_program_offers_tenant_id_idx`(`tenant_id`),
    INDEX `admission_program_offers_session_id_idx`(`session_id`),
    INDEX `admission_program_offers_program_id_idx`(`program_id`),
    UNIQUE INDEX `admission_program_offers_tenant_id_session_id_program_id_key`(`tenant_id`, `session_id`, `program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_enquiries` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NULL,
    `program_id` CHAR(36) NULL,
    `name` TEXT NOT NULL,
    `email` TEXT NULL,
    `phone` TEXT NULL,
    `source` VARCHAR(255) NOT NULL DEFAULT 'WEBSITE',
    `message` TEXT NULL,
    `follow_up_at` DATETIME(3) NULL,
    `converted_to_application_id` CHAR(36) NULL,
    `converted_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_enquiries_tenant_id_idx`(`tenant_id`),
    INDEX `admission_enquiries_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_applications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_number` VARCHAR(191) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `admission_program_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `enquiry_id` CHAR(36) NULL,
    `first_name` TEXT NOT NULL,
    `middle_name` TEXT NULL,
    `last_name` TEXT NOT NULL,
    `full_name` TEXT NOT NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED') NOT NULL DEFAULT 'NOT_SPECIFIED',
    `date_of_birth` DATETIME(3) NULL,
    `email` TEXT NULL,
    `phone` TEXT NULL,
    `category` TEXT NULL,
    `nationality` VARCHAR(255) NULL DEFAULT 'Indian',
    `address_line_1` TEXT NULL,
    `address_line_2` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `postal_code` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `guardian` JSON NULL,
    `data` JSON NULL,
    `remarks` TEXT NULL,
    `status` ENUM('INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED', 'MERIT_LISTED', 'COUNSELLING_SCHEDULED', 'COUNSELLED', 'SELECTED', 'OFFERED', 'OFFER_ACCEPTED', 'FEE_PAID', 'ENROLLED', 'WAITLISTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'INITIATED',
    `submitted_at` DATETIME(3) NULL,
    `submitted_by` CHAR(36) NULL,
    `rejected_reason` TEXT NULL,
    `meritScore` DOUBLE NULL,
    `merit_rank` INTEGER NULL,
    `score_breakdown` JSON NULL,
    `duplicate_of_id` CHAR(36) NULL,
    `counselling_slot_id` CHAR(36) NULL,
    `counselled_at` DATETIME(3) NULL,
    `selected_at` DATETIME(3) NULL,
    `fee_paid_at` DATETIME(3) NULL,
    `fee_receipt_number` TEXT NULL,
    `enrolled_student_id` CHAR(36) NULL,
    `enrolled_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_applications_tenant_id_idx`(`tenant_id`),
    INDEX `admission_applications_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `admission_applications_session_id_idx`(`session_id`),
    INDEX `admission_applications_admission_program_id_idx`(`admission_program_id`),
    INDEX `admission_applications_campus_id_idx`(`campus_id`),
    INDEX `admission_applications_academic_year_id_idx`(`academic_year_id`),
    INDEX `admission_applications_meritScore_idx`(`meritScore`),
    INDEX `admission_applications_duplicate_of_id_idx`(`duplicate_of_id`),
    INDEX `admission_applications_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    UNIQUE INDEX `admission_applications_tenant_id_application_number_key`(`tenant_id`, `application_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `category` TEXT NOT NULL,
    `document_name` TEXT NOT NULL,
    `storage_key` TEXT NULL,
    `original_filename` TEXT NULL,
    `mime_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `verified_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_documents_tenant_id_idx`(`tenant_id`),
    INDEX `admission_documents_application_id_idx`(`application_id`),
    INDEX `admission_documents_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_qualifications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `institution` TEXT NOT NULL,
    `board` TEXT NULL,
    `degree` TEXT NULL,
    `year_of_passing` INTEGER NULL,
    `percentage` DOUBLE NULL,
    `gpa` DOUBLE NULL,
    `grade` TEXT NULL,
    `marks_obtained` INTEGER NULL,
    `marks_out_of` INTEGER NULL,
    `rank` TEXT NULL,
    `is_highest_qualification` BOOLEAN NOT NULL DEFAULT false,
    `verification_status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_qualifications_tenant_id_idx`(`tenant_id`),
    INDEX `admission_qualifications_application_id_idx`(`application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_counselling_slots` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NULL,
    `date` DATETIME(3) NOT NULL,
    `venue` TEXT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 1,
    `booked_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_counselling_slots_tenant_id_idx`(`tenant_id`),
    INDEX `admission_counselling_slots_session_id_idx`(`session_id`),
    INDEX `admission_counselling_slots_program_id_idx`(`program_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_offers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `offer_number` VARCHAR(191) NOT NULL,
    `admission_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `issued_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `status` ENUM('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'ISSUED',
    `accepted_at` DATETIME(3) NULL,
    `declined_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_offers_tenant_id_idx`(`tenant_id`),
    INDEX `admission_offers_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `admission_offers_application_id_idx`(`application_id`),
    UNIQUE INDEX `admission_offers_tenant_id_offer_number_key`(`tenant_id`, `offer_number`),
    UNIQUE INDEX `admission_offers_tenant_id_application_id_key`(`tenant_id`, `application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_fee_payments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `currency` VARCHAR(255) NOT NULL DEFAULT 'INR',
    `payment_date` DATETIME(3) NOT NULL,
    `method` ENUM('CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE') NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'SUCCEEDED',
    `reference_number` TEXT NULL,
    `receipt_number` VARCHAR(191) NOT NULL,
    `remarks` TEXT NULL,
    `recorded_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_fee_payments_tenant_id_idx`(`tenant_id`),
    INDEX `admission_fee_payments_application_id_idx`(`application_id`),
    UNIQUE INDEX `admission_fee_payments_tenant_id_receipt_number_key`(`tenant_id`, `receipt_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_activities` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `event_type` TEXT NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `entity_type` TEXT NULL,
    `entity_id` CHAR(36) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admission_activities_tenant_id_idx`(`tenant_id`),
    INDEX `admission_activities_application_id_idx`(`application_id`),
    INDEX `admission_activities_application_id_occurred_at_idx`(`application_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_form_fields` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` TEXT NOT NULL,
    `field_type` ENUM('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'EMAIL', 'PHONE', 'SELECT', 'RADIO', 'CHECKBOX') NOT NULL,
    `placeholder` TEXT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NULL,
    `help_text` TEXT NULL,
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_form_fields_tenant_id_idx`(`tenant_id`),
    INDEX `admission_form_fields_session_id_idx`(`session_id`),
    UNIQUE INDEX `admission_form_fields_tenant_id_session_id_code_key`(`tenant_id`, `session_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_eligibility_rules` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `rule_type` ENUM('MIN_PERCENTAGE', 'MIN_GPA', 'MIN_MARKS', 'MIN_AGE', 'MAX_AGE', 'CATEGORY_ALLOWED', 'CUSTOM') NOT NULL,
    `config` JSON NULL,
    `applies_to_category` TEXT NULL,
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_eligibility_rules_tenant_id_idx`(`tenant_id`),
    INDEX `admission_eligibility_rules_program_id_idx`(`program_id`),
    INDEX `admission_eligibility_rules_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admission_messages` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `subject` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP') NOT NULL,
    `sent_by` CHAR(36) NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `related_notification_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admission_messages_tenant_id_idx`(`tenant_id`),
    INDEX `admission_messages_application_id_idx`(`application_id`),
    INDEX `admission_messages_application_id_sent_at_idx`(`application_id`, `sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `credit_hours` INTEGER NOT NULL DEFAULT 3,
    `course_type` ENUM('CORE', 'ELECTIVE', 'OPEN_ELECTIVE', 'LABORATORY', 'PROJECT', 'INTERNSHIP', 'MINOR', 'OTHER') NOT NULL DEFAULT 'CORE',
    `grading_basis` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `courses_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    INDEX `courses_department_id_idx`(`department_id`),
    UNIQUE INDEX `courses_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_prerequisites` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `course_id` CHAR(36) NOT NULL,
    `required_course_id` CHAR(36) NOT NULL,
    `min_grade` TEXT NULL,
    `description` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `course_prerequisites_tenant_id_idx`(`tenant_id`),
    INDEX `course_prerequisites_required_course_id_idx`(`required_course_id`),
    UNIQUE INDEX `course_prerequisites_tenant_id_course_id_required_course_id_key`(`tenant_id`, `course_id`, `required_course_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curricula` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `curricula_tenant_id_program_id_idx`(`tenant_id`, `program_id`),
    INDEX `curricula_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `curricula_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curriculum_versions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `curriculum_id` CHAR(36) NOT NULL,
    `version_number` INTEGER NOT NULL,
    `name` TEXT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `effective_from` DATETIME(3) NULL,
    `effective_to` DATETIME(3) NULL,
    `min_total_credits` INTEGER NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `curriculum_versions_tenant_id_curriculum_id_idx`(`tenant_id`, `curriculum_id`),
    INDEX `curriculum_versions_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `curriculum_versions_tenant_id_curriculum_id_version_number_key`(`tenant_id`, `curriculum_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curriculum_courses` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `curriculum_version_id` CHAR(36) NOT NULL,
    `course_id` CHAR(36) NOT NULL,
    `semester` INTEGER NOT NULL,
    `category` TEXT NULL,
    `is_compulsory` BOOLEAN NOT NULL DEFAULT true,
    `sequence` INTEGER NOT NULL DEFAULT 0,
    `min_grade` TEXT NULL,
    `credit_override` INTEGER NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `curriculum_courses_tenant_id_curriculum_version_id_semester_idx`(`tenant_id`, `curriculum_version_id`, `semester`),
    INDEX `curriculum_courses_tenant_id_course_id_idx`(`tenant_id`, `course_id`),
    UNIQUE INDEX `curriculum_courses_tenant_id_curriculum_version_id_course_id_key`(`tenant_id`, `curriculum_version_id`, `course_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_offerings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `course_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `section_id` CHAR(36) NULL,
    `batch_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `credit_hours` INTEGER NULL,
    `status` ENUM('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'PLANNED',
    `mode` TEXT NULL,
    `capacity` INTEGER NULL,
    `waitlist_capacity` INTEGER NULL DEFAULT 0,
    `enrollment_start_at` DATETIME(3) NULL,
    `enrollment_end_at` DATETIME(3) NULL,
    `schedule` JSON NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `course_offerings_tenant_id_term_id_idx`(`tenant_id`, `term_id`),
    INDEX `course_offerings_tenant_id_course_id_idx`(`tenant_id`, `course_id`),
    INDEX `course_offerings_tenant_id_program_id_idx`(`tenant_id`, `program_id`),
    INDEX `course_offerings_tenant_id_section_id_idx`(`tenant_id`, `section_id`),
    INDEX `course_offerings_tenant_id_batch_id_idx`(`tenant_id`, `batch_id`),
    INDEX `course_offerings_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `course_offerings_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `course_offerings_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_offering_faculty` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `course_offering_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('PRIMARY', 'CO_TEACHER', 'ASSISTANT') NOT NULL DEFAULT 'CO_TEACHER',
    `allocation_percent` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `course_offering_faculty_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `course_offering_faculty_tenant_id_course_offering_id_user_id_key`(`tenant_id`, `course_offering_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_registrations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `course_offering_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NOT NULL,
    `status` ENUM('REGISTERED', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'DROPPED', 'COMPLETED') NOT NULL DEFAULT 'REGISTERED',
    `waitlist_position` INTEGER NULL,
    `enrolled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_by_user_id` CHAR(36) NULL,
    `drop_reason` TEXT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `course_registrations_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `course_registrations_tenant_id_student_id_term_id_idx`(`tenant_id`, `student_id`, `term_id`),
    UNIQUE INDEX `course_registrations_tenant_id_student_id_course_offering_id_key`(`tenant_id`, `student_id`, `course_offering_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_advising_records` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `advisor_user_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `session_type` VARCHAR(255) NOT NULL DEFAULT 'ACADEMIC',
    `summary` TEXT NOT NULL,
    `details` TEXT NULL,
    `action_items` TEXT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `follow_up_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `academic_advising_records_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `academic_advising_records_tenant_id_advisor_user_id_idx`(`tenant_id`, `advisor_user_id`),
    INDEX `academic_advising_records_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_progression_records` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `program_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NULL,
    `from_semester` INTEGER NOT NULL,
    `to_semester` INTEGER NOT NULL,
    `status` ENUM('CONTINUING', 'PROMOTED', 'REAPPEARING', 'DETAINED', 'GRADUATED', 'WITHDRAWN') NOT NULL,
    `credits_earned` INTEGER NULL,
    `credits_required` INTEGER NULL,
    `gpa_score` DOUBLE NULL,
    `backlog_open` INTEGER NOT NULL DEFAULT 0,
    `backlog_cleared` INTEGER NOT NULL DEFAULT 0,
    `decision_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `academic_progression_records_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `academic_progression_records_tenant_id_academic_year_id_idx`(`tenant_id`, `academic_year_id`),
    INDEX `academic_progression_records_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_backlogs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `course_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NULL,
    `term_id` CHAR(36) NOT NULL,
    `status` ENUM('OPEN', 'CLEARED', 'EXEMPTED') NOT NULL DEFAULT 'OPEN',
    `cleared_at` DATETIME(3) NULL,
    `cleared_in_registration_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `course_backlogs_tenant_id_student_id_idx`(`tenant_id`, `student_id`),
    INDEX `course_backlogs_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `course_backlogs_tenant_id_student_id_course_id_term_id_key`(`tenant_id`, `student_id`, `course_id`, `term_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_calendar_events` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `event_type` VARCHAR(191) NOT NULL DEFAULT 'EVENT',
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `applies_to` VARCHAR(255) NULL DEFAULT 'GLOBAL',
    `color` TEXT NULL,
    `is_published` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `academic_calendar_events_tenant_id_academic_year_id_idx`(`tenant_id`, `academic_year_id`),
    INDEX `academic_calendar_events_tenant_id_event_type_idx`(`tenant_id`, `event_type`),
    INDEX `academic_calendar_events_tenant_id_is_published_idx`(`tenant_id`, `is_published`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetables` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `code` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'GENERATED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `working_days` JSON NOT NULL,
    `generated_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `published_by_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `timetables_tenant_id_idx`(`tenant_id`),
    INDEX `timetables_tenant_id_term_id_idx`(`tenant_id`, `term_id`),
    INDEX `timetables_tenant_id_campus_id_idx`(`tenant_id`, `campus_id`),
    INDEX `timetables_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `timetables_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `timetables_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_periods` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `start_time` TEXT NOT NULL,
    `end_time` TEXT NOT NULL,
    `is_break` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timetable_periods_tenant_id_timetable_id_idx`(`tenant_id`, `timetable_id`),
    UNIQUE INDEX `timetable_periods_timetable_id_sequence_key`(`timetable_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_entries` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `day_of_week` INTEGER NOT NULL,
    `course_offering_id` CHAR(36) NULL,
    `section_id` CHAR(36) NULL,
    `assigned_user_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `entry_type` ENUM('LECTURE', 'LAB', 'TUTORIAL', 'OTHER') NOT NULL DEFAULT 'LECTURE',
    `title` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timetable_entries_tenant_id_timetable_id_idx`(`tenant_id`, `timetable_id`),
    INDEX `timetable_entries_tenant_id_timetable_id_day_of_week_idx`(`tenant_id`, `timetable_id`, `day_of_week`),
    INDEX `timetable_entries_tenant_id_timetable_id_period_id_day_of_we_idx`(`tenant_id`, `timetable_id`, `period_id`, `day_of_week`),
    INDEX `timetable_entries_tenant_id_section_id_day_of_week_idx`(`tenant_id`, `section_id`, `day_of_week`),
    INDEX `timetable_entries_tenant_id_assigned_user_id_day_of_week_idx`(`tenant_id`, `assigned_user_id`, `day_of_week`),
    INDEX `timetable_entries_tenant_id_room_id_day_of_week_idx`(`tenant_id`, `room_id`, `day_of_week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_holidays` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `timetable_holidays_tenant_id_timetable_id_idx`(`tenant_id`, `timetable_id`),
    UNIQUE INDEX `timetable_holidays_timetable_id_date_key`(`timetable_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_availability` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `day_of_week` INTEGER NOT NULL,
    `start_time` TEXT NOT NULL,
    `end_time` TEXT NOT NULL,
    `is_blocked` BOOLEAN NOT NULL DEFAULT true,
    `note` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `faculty_availability_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    INDEX `faculty_availability_tenant_id_term_id_idx`(`tenant_id`, `term_id`),
    INDEX `faculty_availability_tenant_id_campus_id_idx`(`tenant_id`, `campus_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_conflicts` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `conflict_type` ENUM('ROOM', 'FACULTY', 'SECTION') NOT NULL,
    `day_of_week` INTEGER NOT NULL,
    `period_id` CHAR(36) NULL,
    `entry_a_id` CHAR(36) NULL,
    `entry_b_id` CHAR(36) NULL,
    `substitution_a_id` CHAR(36) NULL,
    `substitution_b_id` CHAR(36) NULL,
    `description` TEXT NOT NULL,
    `source` VARCHAR(255) NOT NULL DEFAULT 'sweep',
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `resolved_by_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `timetable_conflicts_tenant_id_timetable_id_idx`(`tenant_id`, `timetable_id`),
    INDEX `timetable_conflicts_tenant_id_timetable_id_resolved_at_idx`(`tenant_id`, `timetable_id`, `resolved_at`),
    INDEX `timetable_conflicts_tenant_id_entry_a_id_idx`(`tenant_id`, `entry_a_id`),
    INDEX `timetable_conflicts_tenant_id_entry_b_id_idx`(`tenant_id`, `entry_b_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_substitutions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `entry_id` CHAR(36) NOT NULL,
    `original_user_id` CHAR(36) NULL,
    `substitute_user_id` CHAR(36) NOT NULL,
    `effective_date` DATE NOT NULL,
    `reason` TEXT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED', 'EXECUTED') NOT NULL DEFAULT 'REQUESTED',
    `requested_by_id` CHAR(36) NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timetable_substitutions_tenant_id_timetable_id_status_idx`(`tenant_id`, `timetable_id`, `status`),
    INDEX `timetable_substitutions_tenant_id_substitute_user_id_effecti_idx`(`tenant_id`, `substitute_user_id`, `effective_date`),
    UNIQUE INDEX `timetable_substitutions_tenant_id_entry_id_effective_date_key`(`tenant_id`, `entry_id`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timetable_history` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `timetable_id` CHAR(36) NOT NULL,
    `action` TEXT NOT NULL,
    `actor_id` CHAR(36) NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `timetable_history_tenant_id_timetable_id_idx`(`tenant_id`, `timetable_id`),
    INDEX `timetable_history_tenant_id_timetable_id_created_at_idx`(`tenant_id`, `timetable_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_categories` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `parent_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_categories_tenant_id_idx`(`tenant_id`),
    INDEX `library_categories_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `library_categories_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_publishers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `address_line` TEXT NULL,
    `city` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `phone` TEXT NULL,
    `email` TEXT NULL,
    `website` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_publishers_tenant_id_idx`(`tenant_id`),
    INDEX `library_publishers_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `library_publishers_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_authors` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `first_name` TEXT NOT NULL,
    `last_name` TEXT NULL,
    `full_name` VARCHAR(191) NOT NULL,
    `bio` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_authors_tenant_id_idx`(`tenant_id`),
    INDEX `library_authors_tenant_id_full_name_idx`(`tenant_id`, `full_name`),
    INDEX `library_authors_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `library_authors_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_books` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `isbn` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` TEXT NULL,
    `language` VARCHAR(255) NULL DEFAULT 'English',
    `edition` TEXT NULL,
    `page_count` INTEGER NULL,
    `publication_year` INTEGER NULL,
    `description` TEXT NULL,
    `cover_storage_key` TEXT NULL,
    `category_id` CHAR(36) NOT NULL,
    `publisher_id` CHAR(36) NULL,
    `replacement_cost_cents` INTEGER NULL,
    `max_loan_days` INTEGER NOT NULL DEFAULT 14,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_books_tenant_id_idx`(`tenant_id`),
    INDEX `library_books_tenant_id_title_idx`(`tenant_id`, `title`),
    INDEX `library_books_tenant_id_isbn_idx`(`tenant_id`, `isbn`),
    INDEX `library_books_tenant_id_category_id_idx`(`tenant_id`, `category_id`),
    INDEX `library_books_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_book_authors` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `book_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `library_book_authors_tenant_id_author_id_idx`(`tenant_id`, `author_id`),
    UNIQUE INDEX `library_book_authors_tenant_id_book_id_author_id_key`(`tenant_id`, `book_id`, `author_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_copies` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `book_id` CHAR(36) NOT NULL,
    `accession_number` VARCHAR(191) NOT NULL,
    `barcode` VARCHAR(191) NOT NULL,
    `shelf_location` TEXT NULL,
    `acquisition_type` TEXT NULL,
    `acquisition_date` DATETIME(3) NULL,
    `purchase_price_cents` INTEGER NULL,
    `condition` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED') NOT NULL DEFAULT 'GOOD',
    `status` ENUM('AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'WITHDRAWN') NOT NULL DEFAULT 'AVAILABLE',
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_copies_tenant_id_idx`(`tenant_id`),
    INDEX `library_copies_tenant_id_book_id_status_idx`(`tenant_id`, `book_id`, `status`),
    UNIQUE INDEX `library_copies_tenant_id_barcode_key`(`tenant_id`, `barcode`),
    UNIQUE INDEX `library_copies_tenant_id_accession_number_key`(`tenant_id`, `accession_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_members` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `member_number` VARCHAR(191) NOT NULL,
    `student_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `full_name` TEXT NOT NULL,
    `email` TEXT NULL,
    `phone` TEXT NULL,
    `member_type` ENUM('STUDENT', 'FACULTY', 'STAFF', 'OTHER') NOT NULL DEFAULT 'STUDENT',
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `max_loans` INTEGER NULL,
    `membership_start` DATETIME(3) NULL,
    `membership_end` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `library_members_tenant_id_idx`(`tenant_id`),
    INDEX `library_members_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `library_members_tenant_id_member_type_idx`(`tenant_id`, `member_type`),
    INDEX `library_members_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `library_members_tenant_id_member_number_key`(`tenant_id`, `member_number`),
    UNIQUE INDEX `library_members_tenant_id_student_id_key`(`tenant_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_reservations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `book_id` CHAR(36) NOT NULL,
    `copy_id` CHAR(36) NULL,
    `member_id` CHAR(36) NOT NULL,
    `status` ENUM('WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'WAITING',
    `reserved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `hold_until` DATETIME(3) NULL,
    `fulfilled_at` DATETIME(3) NULL,
    `cancelled_by` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_reservations_tenant_id_idx`(`tenant_id`),
    INDEX `library_reservations_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `library_reservations_tenant_id_member_id_status_idx`(`tenant_id`, `member_id`, `status`),
    INDEX `library_reservations_tenant_id_book_id_status_idx`(`tenant_id`, `book_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_fines` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `loan_id` CHAR(36) NULL,
    `member_id` CHAR(36) NOT NULL,
    `type` ENUM('OVERDUE', 'LOST', 'DAMAGE', 'OTHER') NOT NULL,
    `amount_cents` INTEGER NOT NULL,
    `paid_cents` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PAID', 'WAIVED') NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NULL,
    `paid_at` DATETIME(3) NULL,
    `paid_by_user_id` CHAR(36) NULL,
    `waived_at` DATETIME(3) NULL,
    `waived_by_user_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `library_fines_tenant_id_idx`(`tenant_id`),
    INDEX `library_fines_tenant_id_member_id_status_idx`(`tenant_id`, `member_id`, `status`),
    INDEX `library_fines_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `library_fines_loan_id_idx`(`loan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_transactions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `copy_id` CHAR(36) NOT NULL,
    `loan_id` CHAR(36) NULL,
    `member_id` CHAR(36) NULL,
    `type` ENUM('ADDED', 'ISSUED', 'RETURNED', 'RENEWED', 'LOST', 'DAMAGED', 'RESERVED', 'READY', 'FULFILLED', 'CANCELLED', 'WITHDRAWN') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor_user_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `library_transactions_tenant_id_idx`(`tenant_id`),
    INDEX `library_transactions_tenant_id_copy_id_occurred_at_idx`(`tenant_id`, `copy_id`, `occurred_at`),
    INDEX `library_transactions_tenant_id_occurred_at_idx`(`tenant_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_configs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `default_loan_days` INTEGER NOT NULL DEFAULT 14,
    `max_loans_per_member` INTEGER NOT NULL DEFAULT 5,
    `renewal_limit` INTEGER NOT NULL DEFAULT 2,
    `overdue_fine_per_day_cents` INTEGER NOT NULL DEFAULT 100,
    `reservation_hold_days` INTEGER NOT NULL DEFAULT 2,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `library_configs_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_sequences` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` ENUM('MEMBER', 'COPY') NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `library_sequences_tenant_id_kind_prefix_key`(`tenant_id`, `kind`, `prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_vehicles` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `type` ENUM('BUS', 'VAN', 'MINIBUS', 'CAR', 'OTHER') NOT NULL DEFAULT 'BUS',
    `registration_number` VARCHAR(191) NOT NULL,
    `chassis_number` TEXT NULL,
    `engine_number` TEXT NULL,
    `make` TEXT NULL,
    `model` TEXT NULL,
    `year_of_manufacture` INTEGER NULL,
    `fuel_type` TEXT NULL,
    `seating_capacity` INTEGER NULL,
    `standing_capacity` INTEGER NULL,
    `is_ac` BOOLEAN NOT NULL DEFAULT false,
    `gps_device_id` TEXT NULL,
    `status` ENUM('ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SCRAPPED') NOT NULL DEFAULT 'IN_SERVICE',
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_vehicles_tenant_id_idx`(`tenant_id`),
    INDEX `transport_vehicles_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `transport_vehicles_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `transport_vehicles_tenant_id_registration_number_key`(`tenant_id`, `registration_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_vehicle_documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `document_type` ENUM('REGISTRATION', 'INSURANCE', 'FITNESS', 'PERMIT', 'POLLUTION', 'TAX_RECEIPT', 'INSPECTION', 'OTHER') NOT NULL,
    `document_number` TEXT NULL,
    `issue_date` DATETIME(3) NULL,
    `expiry_date` DATETIME(3) NULL,
    `issuer` TEXT NULL,
    `storage_key` TEXT NULL,
    `original_filename` TEXT NULL,
    `mime_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `status` ENUM('VALID', 'EXPIRED', 'EXPIRING_SOON', 'REVOKED') NOT NULL DEFAULT 'VALID',
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_vehicle_documents_tenant_id_idx`(`tenant_id`),
    INDEX `transport_vehicle_documents_tenant_id_vehicle_id_idx`(`tenant_id`, `vehicle_id`),
    INDEX `transport_vehicle_documents_tenant_id_document_type_status_idx`(`tenant_id`, `document_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_drivers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `name` TEXT NOT NULL,
    `phone` TEXT NULL,
    `alternate_phone` TEXT NULL,
    `email` TEXT NULL,
    `license_number` VARCHAR(191) NOT NULL,
    `license_class` TEXT NULL,
    `license_expiry` DATETIME(3) NULL,
    `profile_photo_key` TEXT NULL,
    `joined_at` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_drivers_tenant_id_idx`(`tenant_id`),
    INDEX `transport_drivers_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `transport_drivers_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `transport_drivers_tenant_id_license_number_key`(`tenant_id`, `license_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_driver_assignments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `driver_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `released_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_driver_assignments_tenant_id_idx`(`tenant_id`),
    INDEX `transport_driver_assignments_tenant_id_driver_id_is_active_idx`(`tenant_id`, `driver_id`, `is_active`),
    INDEX `transport_driver_assignments_tenant_id_vehicle_id_is_active_idx`(`tenant_id`, `vehicle_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_routes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `campus_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `distance_km` DOUBLE NULL,
    `estimated_duration_min` INTEGER NULL,
    `monthly_fee_cents` INTEGER NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `vehicle_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_routes_tenant_id_idx`(`tenant_id`),
    INDEX `transport_routes_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `transport_routes_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `transport_routes_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_stops` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `route_id` CHAR(36) NOT NULL,
    `name` TEXT NOT NULL,
    `order` INTEGER NOT NULL,
    `type` ENUM('PICKUP', 'DROP', 'PICKUP_AND_DROP') NOT NULL DEFAULT 'PICKUP',
    `address` TEXT NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `pickup_time` TEXT NULL,
    `drop_time` TEXT NULL,
    `reach_radius_meters` INTEGER NOT NULL DEFAULT 50,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `transport_stops_tenant_id_idx`(`tenant_id`),
    INDEX `transport_stops_tenant_id_route_id_idx`(`tenant_id`, `route_id`),
    UNIQUE INDEX `transport_stops_tenant_id_route_id_order_key`(`tenant_id`, `route_id`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_trips` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `route_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NULL,
    `driver_id` CHAR(36) NULL,
    `date` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `scheduled_departure` DATETIME(3) NULL,
    `scheduled_arrival` DATETIME(3) NULL,
    `actual_departure_at` DATETIME(3) NULL,
    `actual_arrival_at` DATETIME(3) NULL,
    `distance_km` DOUBLE NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` TEXT NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_trips_tenant_id_idx`(`tenant_id`),
    INDEX `transport_trips_tenant_id_route_id_date_idx`(`tenant_id`, `route_id`, `date`),
    INDEX `transport_trips_tenant_id_vehicle_id_date_idx`(`tenant_id`, `vehicle_id`, `date`),
    INDEX `transport_trips_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `transport_trips_tenant_id_route_id_date_key`(`tenant_id`, `route_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_trip_stops` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `trip_id` CHAR(36) NOT NULL,
    `stop_id` CHAR(36) NOT NULL,
    `order` INTEGER NOT NULL,
    `scheduled_time` DATETIME(3) NULL,
    `actual_arrival_at` DATETIME(3) NULL,
    `actual_departure_at` DATETIME(3) NULL,
    `students_boarded` INTEGER NOT NULL DEFAULT 0,
    `students_alighted` INTEGER NOT NULL DEFAULT 0,
    `skipped` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,

    INDEX `transport_trip_stops_tenant_id_idx`(`tenant_id`),
    INDEX `transport_trip_stops_tenant_id_trip_id_idx`(`tenant_id`, `trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_maintenance_records` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `type` ENUM('PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION') NOT NULL,
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `scheduled_date` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `odometer_km` INTEGER NULL,
    `description` TEXT NULL,
    `vendor` TEXT NULL,
    `cost_cents` INTEGER NULL,
    `performed_by` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_maintenance_records_tenant_id_idx`(`tenant_id`),
    INDEX `transport_maintenance_records_tenant_id_vehicle_id_idx`(`tenant_id`, `vehicle_id`),
    INDEX `transport_maintenance_records_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_gps_positions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `trip_id` CHAR(36) NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `speed_kmh` DOUBLE NULL,
    `heading` INTEGER NULL,
    `accuracy_meters` DOUBLE NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source` VARCHAR(255) NOT NULL DEFAULT 'mock',
    `raw_data` JSON NULL,

    INDEX `transport_gps_positions_tenant_id_idx`(`tenant_id`),
    INDEX `transport_gps_positions_tenant_id_vehicle_id_recorded_at_idx`(`tenant_id`, `vehicle_id`, `recorded_at`),
    INDEX `transport_gps_positions_tenant_id_trip_id_recorded_at_idx`(`tenant_id`, `trip_id`, `recorded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_alerts` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NULL,
    `trip_id` CHAR(36) NULL,
    `type` ENUM('SPEEDING', 'OFF_ROUTE', 'GEOFENCE_EXIT', 'GEOFENCE_ENTER', 'UNPLANNED_STOP', 'ENGINE', 'FUEL_LOW', 'DELAYED', 'MAINTENANCE_DUE', 'DOCUMENT_EXPIRING', 'OTHER') NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL,
    `title` TEXT NOT NULL,
    `message` TEXT NOT NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `meta` JSON NULL,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_user_id` TEXT NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by_user_id` TEXT NULL,
    `resolution` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_alerts_tenant_id_idx`(`tenant_id`),
    INDEX `transport_alerts_tenant_id_severity_resolved_at_idx`(`tenant_id`, `severity`, `resolved_at`),
    INDEX `transport_alerts_tenant_id_vehicle_id_created_at_idx`(`tenant_id`, `vehicle_id`, `created_at`),
    INDEX `transport_alerts_tenant_id_trip_id_idx`(`tenant_id`, `trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_gps_configs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(255) NOT NULL DEFAULT 'mock',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `poll_enabled` BOOLEAN NOT NULL DEFAULT false,
    `poll_interval_seconds` INTEGER NOT NULL DEFAULT 30,
    `settings` JSON NULL,
    `last_polled_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `transport_gps_configs_tenant_id_key`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_code` VARCHAR(191) NOT NULL,
    `user_id` CHAR(36) NULL,
    `employee_type` ENUM('FACULTY', 'STAFF', 'ADMIN') NOT NULL DEFAULT 'FACULTY',
    `honorific` TEXT NULL,
    `first_name` TEXT NOT NULL,
    `middle_name` TEXT NULL,
    `last_name` TEXT NOT NULL,
    `gender` TEXT NULL,
    `date_of_birth` DATE NULL,
    `personal_email` TEXT NULL,
    `phone` TEXT NULL,
    `alternate_phone` TEXT NULL,
    `address_line1` TEXT NULL,
    `address_line2` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `postal_code` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `department_id` CHAR(36) NOT NULL,
    `designation_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `reporting_to_id` CHAR(36) NULL,
    `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT', 'INTERN') NOT NULL DEFAULT 'FULL_TIME',
    `employment_status` ENUM('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    `join_date` DATE NULL,
    `confirmation_date` DATE NULL,
    `exit_date` DATE NULL,
    `emergency_contact_name` TEXT NULL,
    `emergency_contact_phone` TEXT NULL,
    `emergency_contact_relation` TEXT NULL,
    `pan_number` TEXT NULL,
    `aadhaar_number` TEXT NULL,
    `bank_account_number` TEXT NULL,
    `bank_name` TEXT NULL,
    `bank_ifsc` TEXT NULL,
    `uan_number` TEXT NULL,
    `qualification` TEXT NULL,
    `specialization` TEXT NULL,
    `profile_photo_key` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `employees_user_id_key`(`user_id`),
    INDEX `employees_tenant_id_idx`(`tenant_id`),
    INDEX `employees_tenant_id_department_id_idx`(`tenant_id`, `department_id`),
    INDEX `employees_tenant_id_designation_id_idx`(`tenant_id`, `designation_id`),
    INDEX `employees_tenant_id_campus_id_idx`(`tenant_id`, `campus_id`),
    INDEX `employees_tenant_id_employee_type_idx`(`tenant_id`, `employee_type`),
    INDEX `employees_tenant_id_employment_status_idx`(`tenant_id`, `employment_status`),
    INDEX `employees_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `employees_tenant_id_employee_code_key`(`tenant_id`, `employee_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_designations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `hr_designations_tenant_id_idx`(`tenant_id`),
    INDEX `hr_designations_tenant_id_department_id_idx`(`tenant_id`, `department_id`),
    INDEX `hr_designations_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `hr_designations_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_joinings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `joining_status` ENUM('PENDING', 'ONBOARDED', 'CONFIRMED', 'CLOSED') NOT NULL DEFAULT 'PENDING',
    `offer_date` DATE NULL,
    `effective_date` DATE NULL,
    `probation_months` INTEGER NULL,
    `confirmation_date` DATE NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_joinings_tenant_id_idx`(`tenant_id`),
    INDEX `employee_joinings_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_exits` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `exit_type` ENUM('RESIGNATION', 'RETIREMENT', 'TERMINATION', 'END_OF_CONTRACT', 'MUTUAL_SEPARATION') NOT NULL,
    `effective_date` DATE NULL,
    `last_working_date` DATE NULL,
    `notice_period_days` INTEGER NULL,
    `relieving_date` DATE NULL,
    `reason` TEXT NULL,
    `no_due_status` VARCHAR(255) NULL DEFAULT 'PENDING',
    `no_due_cleared_at` DATETIME(3) NULL,
    `relieving_letter_key` TEXT NULL,
    `settlement_amount` DECIMAL(12, 2) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_exits_tenant_id_idx`(`tenant_id`),
    INDEX `employee_exits_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    INDEX `employee_exits_tenant_id_exit_type_idx`(`tenant_id`, `exit_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `document_type` ENUM('APPOINTMENT_LETTER', 'OFFER_LETTER', 'ID_PROOF', 'EDUCATIONAL_CERTIFICATE', 'EXPERIENCE_LETTER', 'PAYSLIP', 'RELIEVING_LETTER', 'NO_DUE_CERTIFICATE', 'OTHER') NOT NULL,
    `title` TEXT NULL,
    `description` TEXT NULL,
    `file_key` TEXT NULL,
    `content_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `uploaded_by_user_id` CHAR(36) NULL,
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `verified_by_user_id` TEXT NULL,
    `verified_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_documents_tenant_id_idx`(`tenant_id`),
    INDEX `employee_documents_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    INDEX `employee_documents_tenant_id_document_type_idx`(`tenant_id`, `document_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faculty_workloads` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `term_id` CHAR(36) NULL,
    `workload_type` ENUM('TEACHING', 'ADMINISTRATIVE', 'RESEARCH', 'EXAM_DUTY', 'EXTENSION', 'OTHER') NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `hours_per_week` DOUBLE NOT NULL DEFAULT 0,
    `effective_from` DATE NULL,
    `effective_to` DATE NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `faculty_workloads_tenant_id_idx`(`tenant_id`),
    INDEX `faculty_workloads_tenant_id_employee_id_term_id_idx`(`tenant_id`, `employee_id`, `term_id`),
    INDEX `faculty_workloads_tenant_id_workload_type_idx`(`tenant_id`, `workload_type`),
    INDEX `faculty_workloads_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `category` ENUM('CASUAL', 'SICK', 'EARNED', 'MATERNITY', 'PATERNITY', 'UNPAID', 'HALF_DAY', 'COMPENSATORY', 'SPECIAL', 'OTHER') NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(255) NULL DEFAULT '#3b82f6',
    `max_days_per_year` INTEGER NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT true,
    `requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `leave_types_tenant_id_idx`(`tenant_id`),
    INDEX `leave_types_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    UNIQUE INDEX `leave_types_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_balances` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `year` INTEGER NOT NULL,
    `opening_balance` DOUBLE NOT NULL DEFAULT 0,
    `credited_days` DOUBLE NOT NULL DEFAULT 0,
    `availed_days` DOUBLE NOT NULL DEFAULT 0,
    `adjusted_days` DOUBLE NOT NULL DEFAULT 0,
    `closing_balance` DOUBLE NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_balances_tenant_id_idx`(`tenant_id`),
    INDEX `leave_balances_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    UNIQUE INDEX `leave_balances_tenant_id_employee_id_leave_type_id_year_key`(`tenant_id`, `employee_id`, `leave_type_id`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_applications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `duration_days` DOUBLE NOT NULL,
    `half_day_option` TEXT NULL,
    `reason` TEXT NULL,
    `attachment_key` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `approved_by_user_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_applications_tenant_id_idx`(`tenant_id`),
    INDEX `leave_applications_tenant_id_employee_id_status_idx`(`tenant_id`, `employee_id`, `status`),
    INDEX `leave_applications_tenant_id_status_from_date_idx`(`tenant_id`, `status`, `from_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_performance_reviews` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `review_period_start` DATE NULL,
    `review_period_end` DATE NULL,
    `review_type` ENUM('SELF', 'SUPERVISOR', 'PEER', 'COMMITTEE') NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `score` DECIMAL(3, 2) NULL,
    `goals` JSON NULL,
    `achievements` TEXT NULL,
    `areas_for_improvement` TEXT NULL,
    `overall_comments` TEXT NULL,
    `reviewer_user_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_performance_reviews_tenant_id_idx`(`tenant_id`),
    INDEX `employee_performance_reviews_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    INDEX `employee_performance_reviews_tenant_id_status_review_type_idx`(`tenant_id`, `status`, `review_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structures` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `effective_from` DATE NULL,
    `effective_to` DATE NULL,
    `basic_amount` DECIMAL(12, 2) NOT NULL,
    `hra_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `allowances` JSON NULL,
    `deductions` JSON NULL,
    `gross_amount` DECIMAL(12, 2) NOT NULL,
    `net_amount` DECIMAL(12, 2) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `salary_structures_tenant_id_idx`(`tenant_id`),
    INDEX `salary_structures_tenant_id_employee_id_is_active_idx`(`tenant_id`, `employee_id`, `is_active`),
    INDEX `salary_structures_tenant_id_employee_id_effective_from_idx`(`tenant_id`, `employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `title` TEXT NULL,
    `status` ENUM('DRAFT', 'PROCESSING', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `processed_by_user_id` CHAR(36) NULL,
    `approved_by_user_id` CHAR(36) NULL,
    `processed_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_runs_tenant_id_idx`(`tenant_id`),
    INDEX `payroll_runs_tenant_id_status_year_idx`(`tenant_id`, `status`, `year`),
    UNIQUE INDEX `payroll_runs_tenant_id_month_year_key`(`tenant_id`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run_lines` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `salary_structure_id` CHAR(36) NULL,
    `days_worked` INTEGER NULL,
    `gross_amount` DECIMAL(12, 2) NOT NULL,
    `total_deductions` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `net_amount` DECIMAL(12, 2) NOT NULL,
    `earnings` JSON NULL,
    `deductions` JSON NULL,
    `status` ENUM('DRAFT', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `paid_at` DATETIME(3) NULL,
    `payslip_document_id` CHAR(36) NULL,
    `reference_number` TEXT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_run_lines_tenant_id_idx`(`tenant_id`),
    INDEX `payroll_run_lines_tenant_id_run_id_idx`(`tenant_id`, `run_id`),
    INDEX `payroll_run_lines_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_companies` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `company_type` ENUM('MNC', 'INDIAN_MNC', 'STARTUP', 'PSU', 'CORPORATE', 'SME', 'GOVT_ORG', 'NGO', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `industry` TEXT NULL,
    `website` TEXT NULL,
    `description` TEXT NULL,
    `headquarters_city` TEXT NULL,
    `address_line_1` TEXT NULL,
    `address_line_2` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_companies_tenant_id_idx`(`tenant_id`),
    INDEX `placement_companies_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `placement_companies_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_contacts` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `full_name` TEXT NOT NULL,
    `designation` TEXT NULL,
    `email` TEXT NULL,
    `phone` TEXT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_contacts_tenant_id_idx`(`tenant_id`),
    INDEX `placement_contacts_company_id_idx`(`company_id`),
    INDEX `placement_contacts_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_drives` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `mode` ENUM('ON_CAMPUS', 'OFF_CAMPUS', 'VIRTUAL') NOT NULL DEFAULT 'ON_CAMPUS',
    `status` ENUM('DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `drive_date` DATETIME(3) NULL,
    `application_deadline` DATETIME(3) NULL,
    `venue` TEXT NULL,
    `coordinator_contact_id` CHAR(36) NULL,
    `eligibility_notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_drives_tenant_id_idx`(`tenant_id`),
    INDEX `placement_drives_company_id_idx`(`company_id`),
    INDEX `placement_drives_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `placement_drives_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `placement_drives_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_positions` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `position_type` ENUM('FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'TRAINEE') NOT NULL DEFAULT 'FULL_TIME',
    `location` TEXT NULL,
    `openings` INTEGER NULL DEFAULT 1,
    `description` TEXT NULL,
    `min_cgpa` DOUBLE NULL,
    `min_percentage` DOUBLE NULL,
    `max_backlogs` INTEGER NULL,
    `package_cents` INTEGER NULL,
    `package_notes` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_positions_tenant_id_idx`(`tenant_id`),
    INDEX `placement_positions_drive_id_idx`(`drive_id`),
    INDEX `placement_positions_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_eligibility` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `position_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'EXEMPTED') NOT NULL DEFAULT 'PENDING',
    `criteria_snapshot` JSON NULL,
    `student_snapshot` JSON NULL,
    `remarks` TEXT NULL,
    `evaluated_by_user_id` CHAR(36) NULL,
    `evaluated_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `placement_eligibility_tenant_id_idx`(`tenant_id`),
    INDEX `placement_eligibility_student_id_idx`(`student_id`),
    INDEX `placement_eligibility_drive_id_idx`(`drive_id`),
    INDEX `placement_eligibility_position_id_idx`(`position_id`),
    UNIQUE INDEX `placement_eligibility_tenant_id_drive_id_position_id_student_key`(`tenant_id`, `drive_id`, `position_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_resumes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `file_key` TEXT NOT NULL,
    `content_type` TEXT NULL,
    `size_bytes` INTEGER NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `uploaded_by_user_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_resumes_tenant_id_idx`(`tenant_id`),
    INDEX `placement_resumes_student_id_idx`(`student_id`),
    INDEX `placement_resumes_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_applications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `position_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `resume_id` CHAR(36) NULL,
    `status` ENUM('APPLIED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'APPLIED',
    `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `shortlisted_at` DATETIME(3) NULL,
    `rejected_at` DATETIME(3) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `placement_applications_tenant_id_idx`(`tenant_id`),
    INDEX `placement_applications_drive_id_idx`(`drive_id`),
    INDEX `placement_applications_position_id_idx`(`position_id`),
    INDEX `placement_applications_student_id_idx`(`student_id`),
    INDEX `placement_applications_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `placement_applications_tenant_id_drive_id_position_id_studen_key`(`tenant_id`, `drive_id`, `position_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_rounds` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `round_type` ENUM('APTITUDE_TEST', 'TECHNICAL_TEST', 'PSYCHOMETRIC_TEST', 'GROUP_DISCUSSION', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW', 'MANAGERIAL_INTERVIEW', 'CASE_STUDY', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `title` TEXT NULL,
    `scheduled_at` DATETIME(3) NULL,
    `location_or_link` TEXT NULL,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `placement_rounds_tenant_id_idx`(`tenant_id`),
    INDEX `placement_rounds_drive_id_idx`(`drive_id`),
    UNIQUE INDEX `placement_rounds_tenant_id_drive_id_sequence_key`(`tenant_id`, `drive_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_round_results` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `round_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `result` ENUM('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD', 'ABSENT') NOT NULL DEFAULT 'PENDING',
    `score` DOUBLE NULL,
    `feedback` TEXT NULL,
    `assessed_by_user_id` CHAR(36) NULL,
    `assessed_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `placement_round_results_tenant_id_idx`(`tenant_id`),
    INDEX `placement_round_results_round_id_idx`(`round_id`),
    INDEX `placement_round_results_application_id_idx`(`application_id`),
    UNIQUE INDEX `placement_round_results_tenant_id_round_id_application_id_key`(`tenant_id`, `round_id`, `application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_selections` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `position_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `selected_by_user_id` CHAR(36) NULL,
    `selected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `placement_selections_application_id_key`(`application_id`),
    INDEX `placement_selections_tenant_id_idx`(`tenant_id`),
    INDEX `placement_selections_drive_id_idx`(`drive_id`),
    INDEX `placement_selections_position_id_idx`(`position_id`),
    INDEX `placement_selections_student_id_idx`(`student_id`),
    UNIQUE INDEX `placement_selections_tenant_id_application_id_key`(`tenant_id`, `application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_offers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `position_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `selection_id` CHAR(36) NULL,
    `student_id` CHAR(36) NOT NULL,
    `offer_letter_number` VARCHAR(191) NOT NULL,
    `package_cents` INTEGER NULL,
    `joining_location` TEXT NULL,
    `status` ENUM('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'ISSUED',
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accepted_at` DATETIME(3) NULL,
    `declined_at` DATETIME(3) NULL,
    `expiry_date` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `placement_offers_application_id_key`(`application_id`),
    UNIQUE INDEX `placement_offers_selection_id_key`(`selection_id`),
    INDEX `placement_offers_tenant_id_idx`(`tenant_id`),
    INDEX `placement_offers_drive_id_idx`(`drive_id`),
    INDEX `placement_offers_position_id_idx`(`position_id`),
    INDEX `placement_offers_student_id_idx`(`student_id`),
    INDEX `placement_offers_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `placement_offers_tenant_id_offer_letter_number_key`(`tenant_id`, `offer_letter_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_joinings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NOT NULL,
    `offer_id` CHAR(36) NOT NULL,
    `expected_joining_date` DATETIME(3) NULL,
    `actual_joining_date` DATETIME(3) NULL,
    `joining_location` TEXT NULL,
    `status` ENUM('PENDING', 'JOINED', 'NOT_JOINED', 'POSTPONED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `placement_joinings_offer_id_key`(`offer_id`),
    INDEX `placement_joinings_tenant_id_idx`(`tenant_id`),
    INDEX `placement_joinings_offer_id_idx`(`offer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `placement_outcomes` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `academic_year_id` CHAR(36) NOT NULL,
    `student_id` CHAR(36) NOT NULL,
    `drive_id` CHAR(36) NULL,
    `position_id` CHAR(36) NULL,
    `offer_id` CHAR(36) NULL,
    `outcome_status` ENUM('PLACED', 'NOT_PLACED', 'OPTED_OUT', 'UNREGISTERED') NOT NULL DEFAULT 'UNREGISTERED',
    `final_package_cents` INTEGER NULL,
    `placed_at` DATETIME(3) NULL,
    `declared_by_user_id` CHAR(36) NULL,
    `remarks` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `placement_outcomes_tenant_id_idx`(`tenant_id`),
    INDEX `placement_outcomes_academic_year_id_idx`(`academic_year_id`),
    INDEX `placement_outcomes_student_id_idx`(`student_id`),
    INDEX `placement_outcomes_tenant_id_outcome_status_idx`(`tenant_id`, `outcome_status`),
    INDEX `placement_outcomes_tenant_id_academic_year_id_outcome_status_idx`(`tenant_id`, `academic_year_id`, `outcome_status`),
    UNIQUE INDEX `placement_outcomes_tenant_id_academic_year_id_student_id_key`(`tenant_id`, `academic_year_id`, `student_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_sequences` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` ENUM('VENDOR', 'CATEGORY', 'PRODUCT', 'LOCATION', 'PURCHASE_REQUEST', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'ASSET', 'ASSET_TAG', 'MAINTENANCE', 'WARRANTY_CLAIM', 'DISPOSAL') NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_sequences_tenant_id_kind_prefix_key`(`tenant_id`, `kind`, `prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_categories` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` ENUM('PRODUCT', 'ASSET') NOT NULL DEFAULT 'PRODUCT',
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `parent_id` CHAR(36) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_categories_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_categories_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `inventory_categories_tenant_id_kind_code_key`(`tenant_id`, `kind`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_vendors` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `gstin` TEXT NULL,
    `contact_person` TEXT NULL,
    `phone` TEXT NULL,
    `email` TEXT NULL,
    `address_line1` TEXT NULL,
    `address_line2` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `postal_code` TEXT NULL,
    `country` VARCHAR(255) NULL DEFAULT 'India',
    `website` TEXT NULL,
    `payment_terms` TEXT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_vendors_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_vendors_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `inventory_vendors_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_products` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `category_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `sku` TEXT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `unit` VARCHAR(255) NOT NULL DEFAULT 'PCS',
    `unit_price_cents` INTEGER NULL,
    `reorder_level` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_products_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_products_tenant_id_category_id_idx`(`tenant_id`, `category_id`),
    INDEX `inventory_products_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `inventory_products_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_locations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `type` ENUM('WAREHOUSE', 'STORE', 'LAB', 'ROOM', 'OTHER') NOT NULL DEFAULT 'STORE',
    `campus_id` CHAR(36) NULL,
    `building_id` CHAR(36) NULL,
    `room_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_locations_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_locations_tenant_id_campus_id_idx`(`tenant_id`, `campus_id`),
    INDEX `inventory_locations_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `inventory_locations_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `location_id` CHAR(36) NOT NULL,
    `quantity_on_hand` INTEGER NOT NULL DEFAULT 0,
    `reserved_quantity` INTEGER NOT NULL DEFAULT 0,
    `last_movement_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_stock_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_items_tenant_id_product_id_idx`(`tenant_id`, `product_id`),
    INDEX `inventory_stock_items_tenant_id_location_id_idx`(`tenant_id`, `location_id`),
    UNIQUE INDEX `inventory_stock_items_tenant_id_location_id_product_id_key`(`tenant_id`, `location_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_movements` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `location_id` CHAR(36) NOT NULL,
    `type` ENUM('INITIAL', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUBTRACT') NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `quantity_before` INTEGER NOT NULL,
    `quantity_after` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `reference_type` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `posted_by` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_stock_movements_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_movements_tenant_id_product_id_occurred_at_idx`(`tenant_id`, `product_id`, `occurred_at`),
    INDEX `inventory_stock_movements_tenant_id_location_id_occurred_at_idx`(`tenant_id`, `location_id`, `occurred_at`),
    INDEX `inventory_stock_movements_tenant_id_reference_type_reference_idx`(`tenant_id`, `reference_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_purchase_requests` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `request_number` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `requested_by` TEXT NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `department_id` CHAR(36) NULL,
    `vendor_id` CHAR(36) NULL,
    `requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `reviewed_by_id` TEXT NULL,
    `approved_by_id` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `rejection_reason` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_purchase_requests_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_purchase_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_purchase_request_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `quantity_requested` INTEGER NOT NULL,
    `quantity_approved` INTEGER NULL,
    `unit_price_cents` INTEGER NULL,
    `notes` TEXT NULL,

    INDEX `inventory_purchase_request_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_purchase_request_items_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_purchase_orders` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `po_number` TEXT NOT NULL,
    `vendor_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `purchase_request_id` CHAR(36) NULL,
    `order_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expected_date` DATETIME(3) NULL,
    `total_cents` INTEGER NOT NULL DEFAULT 0,
    `approved_by_id` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `received_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_purchase_orders_purchase_request_id_key`(`purchase_request_id`),
    INDEX `inventory_purchase_orders_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_purchase_orders_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_purchase_order_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `po_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `quantity_ordered` INTEGER NOT NULL,
    `quantity_received` INTEGER NOT NULL DEFAULT 0,
    `unit_price_cents` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,

    INDEX `inventory_purchase_order_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_purchase_order_items_po_id_idx`(`po_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_goods_receipts` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `grn_number` TEXT NOT NULL,
    `vendor_id` CHAR(36) NOT NULL,
    `po_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `received_by` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_goods_receipts_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_goods_receipts_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_goods_receipt_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `grn_id` CHAR(36) NOT NULL,
    `po_item_id` CHAR(36) NULL,
    `product_id` CHAR(36) NOT NULL,
    `location_id` CHAR(36) NOT NULL,
    `quantity_received` INTEGER NOT NULL,
    `unit_price_cents` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_goods_receipt_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_goods_receipt_items_grn_id_idx`(`grn_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_transfers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `transfer_number` TEXT NOT NULL,
    `from_location_id` CHAR(36) NOT NULL,
    `to_location_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requested_by` TEXT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_by` TEXT NULL,
    `completed_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_stock_transfers_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_transfers_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_transfer_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `transfer_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_stock_transfer_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_transfer_items_transfer_id_idx`(`transfer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_adjustments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `adjustment_number` TEXT NOT NULL,
    `location_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `reason` TEXT NULL,
    `description` TEXT NULL,
    `adjusted_by` TEXT NULL,
    `adjusted_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_stock_adjustments_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_adjustments_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_stock_adjustment_items` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `adjustment_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_stock_adjustment_items_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_stock_adjustment_items_adjustment_id_idx`(`adjustment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_assets` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_code` VARCHAR(191) NOT NULL,
    `tag_number` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `category_id` CHAR(36) NOT NULL,
    `vendor_id` CHAR(36) NULL,
    `location_id` CHAR(36) NULL,
    `serial_number` TEXT NULL,
    `brand` TEXT NULL,
    `model_name` TEXT NULL,
    `purchase_date` DATE NULL,
    `purchase_cost_cents` INTEGER NULL,
    `warranty_start_date` DATE NULL,
    `warranty_end_date` DATE NULL,
    `warranty_provider` TEXT NULL,
    `status` ENUM('IN_STOCK', 'ASSIGNED', 'UNDER_MAINTENANCE', 'DECOMMISSIONED', 'DISPOSED', 'WRITTEN_OFF') NOT NULL DEFAULT 'IN_STOCK',
    `condition` ENUM('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'DISPOSED') NOT NULL DEFAULT 'NEW',
    `depreciation_method` ENUM('NONE', 'STRAIGHT_LINE') NOT NULL DEFAULT 'NONE',
    `useful_life_months` INTEGER NULL,
    `salvage_value_cents` INTEGER NOT NULL DEFAULT 0,
    `current_book_value_cents` INTEGER NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `inventory_assets_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_assets_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `inventory_assets_tenant_id_category_id_idx`(`tenant_id`, `category_id`),
    INDEX `inventory_assets_tenant_id_deleted_at_idx`(`tenant_id`, `deleted_at`),
    UNIQUE INDEX `inventory_assets_tenant_id_asset_code_key`(`tenant_id`, `asset_code`),
    UNIQUE INDEX `inventory_assets_tenant_id_tag_number_key`(`tenant_id`, `tag_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_asset_assignments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `assignee_type` ENUM('EMPLOYEE', 'DEPARTMENT', 'CAMPUS', 'OTHER') NOT NULL,
    `employee_id` CHAR(36) NULL,
    `department_id` CHAR(36) NULL,
    `campus_id` CHAR(36) NULL,
    `assignee_name` TEXT NULL,
    `assigned_by` TEXT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returned_at` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'RETURNED') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_asset_assignments_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_asset_assignments_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    INDEX `inventory_asset_assignments_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_asset_maintenance` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `maintenance_number` TEXT NOT NULL,
    `vendor_id` CHAR(36) NULL,
    `type` ENUM('PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'OTHER') NOT NULL DEFAULT 'PREVENTIVE',
    `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `scheduled_date` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `description` TEXT NULL,
    `cost_cents` INTEGER NULL,
    `performed_by` TEXT NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_asset_maintenance_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_asset_maintenance_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    INDEX `inventory_asset_maintenance_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_asset_warranty_claims` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `claim_number` TEXT NOT NULL,
    `status` ENUM('OPEN', 'APPROVED', 'REPAIRED', 'REJECTED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` TEXT NULL,
    `resolution` TEXT NULL,
    `cost_cents` INTEGER NOT NULL DEFAULT 0,
    `closed_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_asset_warranty_claims_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_asset_warranty_claims_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_asset_depreciation_entries` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `method` ENUM('NONE', 'STRAIGHT_LINE') NOT NULL DEFAULT 'STRAIGHT_LINE',
    `opening_book_value_cents` INTEGER NOT NULL,
    `depreciation_cents` INTEGER NOT NULL,
    `closing_book_value_cents` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_asset_depreciation_entries_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_asset_depreciation_entries_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    UNIQUE INDEX `inventory_asset_depreciation_entries_tenant_id_asset_id_peri_key`(`tenant_id`, `asset_id`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_asset_disposals` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `asset_id` CHAR(36) NOT NULL,
    `disposal_number` TEXT NOT NULL,
    `type` ENUM('SALE', 'SCRAP', 'DONATION', 'RETURN_TO_VENDOR') NOT NULL DEFAULT 'SCRAP',
    `status` ENUM('DRAFT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `disposal_date` DATE NULL,
    `proceeds_cents` INTEGER NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `approved_by` TEXT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_asset_disposals_tenant_id_idx`(`tenant_id`),
    INDEX `inventory_asset_disposals_tenant_id_asset_id_idx`(`tenant_id`, `asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_sequences` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` ENUM('TICKET') NOT NULL,
    `prefix` TEXT NOT NULL,
    `next_value` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_sequences_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `helpdesk_sequences_tenant_id_kind_key`(`tenant_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_departments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `email` TEXT NULL,
    `campus_id` CHAR(36) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_departments_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `helpdesk_departments_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_categories` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `parent_id` CHAR(36) NULL,
    `default_priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `default_department_id` CHAR(36) NULL,
    `sla_policy_id` CHAR(36) NULL,
    `requires_approval` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sequence_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_categories_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_categories_tenant_id_parent_id_idx`(`tenant_id`, `parent_id`),
    UNIQUE INDEX `helpdesk_categories_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_sla_policies` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL') NULL,
    `department_id` CHAR(36) NULL,
    `response_minutes` INTEGER NOT NULL DEFAULT 240,
    `resolution_minutes` INTEGER NOT NULL DEFAULT 1440,
    `at_risk_minutes` INTEGER NULL,
    `escalate_to_role_code` TEXT NULL,
    `escalate_after_minutes` INTEGER NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_sla_policies_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_sla_policies_tenant_id_priority_idx`(`tenant_id`, `priority`),
    INDEX `helpdesk_sla_policies_tenant_id_department_id_idx`(`tenant_id`, `department_id`),
    UNIQUE INDEX `helpdesk_sla_policies_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_tickets` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_number` VARCHAR(191) NOT NULL,
    `subject` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED') NOT NULL DEFAULT 'NEW',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `source` ENUM('WEB', 'EMAIL', 'PHONE', 'WALK_IN', 'API', 'OTHER') NOT NULL DEFAULT 'WEB',
    `category_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `sla_policy_id` CHAR(36) NULL,
    `requester_user_id` CHAR(36) NULL,
    `requester_name` TEXT NULL,
    `requester_email` TEXT NULL,
    `assigned_to_user_id` CHAR(36) NULL,
    `response_due_at` DATETIME(3) NULL,
    `resolution_due_at` DATETIME(3) NULL,
    `first_responded_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `reopened_count` INTEGER NOT NULL DEFAULT 0,
    `escalation_level` INTEGER NOT NULL DEFAULT 0,
    `escalated_at` DATETIME(3) NULL,
    `resolution_summary` TEXT NULL,
    `tags` JSON NOT NULL,
    `satisfaction_score` INTEGER NULL,
    `satisfaction_comment` TEXT NULL,
    `satisfaction_submitted_at` DATETIME(3) NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_tickets_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_tickets_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `helpdesk_tickets_tenant_id_priority_idx`(`tenant_id`, `priority`),
    INDEX `helpdesk_tickets_tenant_id_assigned_to_user_id_idx`(`tenant_id`, `assigned_to_user_id`),
    INDEX `helpdesk_tickets_tenant_id_department_id_idx`(`tenant_id`, `department_id`),
    INDEX `helpdesk_tickets_tenant_id_category_id_idx`(`tenant_id`, `category_id`),
    INDEX `helpdesk_tickets_tenant_id_resolution_due_at_idx`(`tenant_id`, `resolution_due_at`),
    UNIQUE INDEX `helpdesk_tickets_tenant_id_ticket_number_key`(`tenant_id`, `ticket_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_ticket_comments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `author_user_id` CHAR(36) NULL,
    `visibility` ENUM('PUBLIC', 'INTERNAL') NOT NULL DEFAULT 'PUBLIC',
    `body` TEXT NOT NULL,
    `is_resolution_note` BOOLEAN NOT NULL DEFAULT false,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `helpdesk_ticket_comments_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_ticket_comments_tenant_id_ticket_id_idx`(`tenant_id`, `ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_ticket_attachments` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `comment_id` CHAR(36) NULL,
    `document_id` CHAR(36) NOT NULL,
    `filename` TEXT NOT NULL,
    `mime_type` TEXT NOT NULL,
    `size_bytes` INTEGER NULL,
    `uploaded_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `helpdesk_ticket_attachments_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_ticket_attachments_tenant_id_ticket_id_idx`(`tenant_id`, `ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_ticket_history` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `event` ENUM('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'PRIORITY_CHANGED', 'DEPARTMENT_CHANGED', 'CATEGORY_CHANGED', 'COMMENTED', 'ATTACHED', 'ESCALATED', 'RESOLVED', 'REOPENED', 'CLOSED', 'FEEDBACK_SUBMITTED', 'SLA_BREACHED') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `actor_type` VARCHAR(255) NOT NULL DEFAULT 'USER',
    `from_value` TEXT NULL,
    `to_value` TEXT NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `helpdesk_ticket_history_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_ticket_history_tenant_id_ticket_id_idx`(`tenant_id`, `ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_escalations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `reason` ENUM('RESPONSE_BREACH', 'RESOLUTION_BREACH', 'MANUAL') NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `from_assignee_user_id` CHAR(36) NULL,
    `to_user_id` CHAR(36) NULL,
    `to_role_code` TEXT NULL,
    `note` TEXT NULL,
    `escalated_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `helpdesk_escalations_tenant_id_idx`(`tenant_id`),
    INDEX `helpdesk_escalations_tenant_id_ticket_id_idx`(`tenant_id`, `ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_feedback` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `ticket_id` CHAR(36) NOT NULL,
    `score` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `submitted_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `helpdesk_feedback_tenant_id_idx`(`tenant_id`),
    UNIQUE INDEX `helpdesk_feedback_tenant_id_ticket_id_key`(`tenant_id`, `ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_reports` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `report_type` ENUM('ADMISSIONS', 'STUDENTS', 'ATTENDANCE', 'FEES', 'EXAMS', 'PLACEMENTS', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'INVENTORY') NOT NULL,
    `filters` JSON NOT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `saved_reports_tenant_id_idx`(`tenant_id`),
    INDEX `saved_reports_tenant_id_owner_id_idx`(`tenant_id`, `owner_id`),
    INDEX `saved_reports_tenant_id_report_type_idx`(`tenant_id`, `report_type`),
    UNIQUE INDEX `saved_reports_tenant_id_owner_id_name_key`(`tenant_id`, `owner_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_templates` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `report_type` ENUM('ADMISSIONS', 'STUDENTS', 'ATTENDANCE', 'FEES', 'EXAMS', 'PLACEMENTS', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'INVENTORY') NOT NULL,
    `definition` JSON NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `report_templates_tenant_id_idx`(`tenant_id`),
    INDEX `report_templates_tenant_id_report_type_idx`(`tenant_id`, `report_type`),
    UNIQUE INDEX `report_templates_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_schedules` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `report_type` ENUM('ADMISSIONS', 'STUDENTS', 'ATTENDANCE', 'FEES', 'EXAMS', 'PLACEMENTS', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'INVENTORY') NOT NULL,
    `template_id` CHAR(36) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `frequency` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `format` ENUM('CSV', 'EXCEL', 'PDF') NOT NULL,
    `filters` JSON NOT NULL,
    `scope_snapshot` JSON NOT NULL,
    `timezone` VARCHAR(255) NOT NULL DEFAULT 'Asia/Kolkata',
    `time_of_day` VARCHAR(5) NOT NULL,
    `day_of_week` INTEGER NULL,
    `day_of_month` INTEGER NULL,
    `next_run_at` DATETIME(3) NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `report_schedules_tenant_id_idx`(`tenant_id`),
    INDEX `report_schedules_tenant_id_created_by_id_idx`(`tenant_id`, `created_by_id`),
    INDEX `report_schedules_tenant_id_is_active_next_run_at_idx`(`tenant_id`, `is_active`, `next_run_at`),
    UNIQUE INDEX `report_schedules_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_runs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `report_type` ENUM('ADMISSIONS', 'STUDENTS', 'ATTENDANCE', 'FEES', 'EXAMS', 'PLACEMENTS', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'INVENTORY') NOT NULL,
    `format` ENUM('CSV', 'EXCEL', 'PDF') NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `filters` JSON NOT NULL,
    `scope_snapshot` JSON NOT NULL,
    `template_snapshot` JSON NULL,
    `requested_by_id` CHAR(36) NULL,
    `saved_report_id` CHAR(36) NULL,
    `template_id` CHAR(36) NULL,
    `schedule_id` CHAR(36) NULL,
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `file_name` TEXT NULL,
    `object_key` TEXT NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `report_runs_tenant_id_idx`(`tenant_id`),
    INDEX `report_runs_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `report_runs_tenant_id_requested_by_id_idx`(`tenant_id`, `requested_by_id`),
    INDEX `report_runs_tenant_id_schedule_id_idx`(`tenant_id`, `schedule_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analytics_snapshots` (
    `id` VARCHAR(512) NOT NULL,
    `scope` ENUM('PLATFORM', 'TENANT') NOT NULL DEFAULT 'TENANT',
    `scope_key` VARCHAR(191) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `granularity` ENUM('DAILY', 'MONTHLY') NOT NULL DEFAULT 'DAILY',
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `metrics` JSON NOT NULL,
    `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `analytics_snapshots_scope_key_period_start_idx`(`scope_key`, `period_start` DESC),
    INDEX `analytics_snapshots_tenant_id_period_start_idx`(`tenant_id`, `period_start` DESC),
    UNIQUE INDEX `analytics_snapshots_scope_scope_key_granularity_period_start_key`(`scope`, `scope_key`, `granularity`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_conversations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_conversations_tenant_id_owner_id_updated_at_idx`(`tenant_id`, `owner_id`, `updated_at` DESC),
    INDEX `ai_conversations_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `role` TEXT NOT NULL,
    `intent` ENUM('LOW_ATTENDANCE_STUDENTS', 'OUTSTANDING_FEES', 'ADMISSIONS_STATISTICS', 'DEPARTMENT_PERFORMANCE', 'EXAM_PERFORMANCE', 'PLACEMENT_STATISTICS', 'ANALYTICS_OVERVIEW', 'REPORT_GENERATION', 'COMMUNICATION_DRAFT', 'STUDENT_RISK_INSIGHTS') NULL,
    `content` TEXT NOT NULL,
    `payload` JSON NULL,
    `filters` JSON NULL,
    `scope_snapshot` JSON NULL,
    `response_kind` ENUM('DATA', 'DATA_WITH_NARRATION', 'GENERATED_TEXT', 'UNSUPPORTED', 'FORBIDDEN', 'FAILED') NOT NULL DEFAULT 'DATA',
    `provider` TEXT NULL,
    `model` TEXT NULL,
    `prompt_tokens` INTEGER NULL,
    `completion_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_tenant_id_conversation_id_created_at_idx`(`tenant_id`, `conversation_id`, `created_at`),
    INDEX `ai_messages_tenant_id_created_at_idx`(`tenant_id`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_query_logs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NULL,
    `message_id` CHAR(36) NULL,
    `user_id` CHAR(36) NOT NULL,
    `question` TEXT NOT NULL,
    `intent` ENUM('LOW_ATTENDANCE_STUDENTS', 'OUTSTANDING_FEES', 'ADMISSIONS_STATISTICS', 'DEPARTMENT_PERFORMANCE', 'EXAM_PERFORMANCE', 'PLACEMENT_STATISTICS', 'ANALYTICS_OVERVIEW', 'REPORT_GENERATION', 'COMMUNICATION_DRAFT', 'STUDENT_RISK_INSIGHTS') NULL,
    `outcome` ENUM('DATA', 'DATA_WITH_NARRATION', 'GENERATED_TEXT', 'UNSUPPORTED', 'FORBIDDEN', 'FAILED') NOT NULL DEFAULT 'DATA',
    `scope_snapshot` JSON NULL,
    `filters` JSON NULL,
    `sourcePermission` TEXT NULL,
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_query_logs_message_id_key`(`message_id`),
    INDEX `ai_query_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at` DESC),
    INDEX `ai_query_logs_tenant_id_user_id_created_at_idx`(`tenant_id`, `user_id`, `created_at` DESC),
    INDEX `ai_query_logs_tenant_id_intent_created_at_idx`(`tenant_id`, `intent`, `created_at` DESC),
    INDEX `ai_query_logs_tenant_id_outcome_idx`(`tenant_id`, `outcome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_feedback` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `message_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `rating` TEXT NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_feedback_message_id_key`(`message_id`),
    INDEX `ai_feedback_tenant_id_created_at_idx`(`tenant_id`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_document_classifications` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `document_version_id` CHAR(36) NOT NULL,
    `suggested_category` TEXT NULL,
    `suggested_type_id` CHAR(36) NULL,
    `confidence` DOUBLE NULL,
    `extracted_text` TEXT NULL,
    `extracted_fields` JSON NULL,
    `status` ENUM('PENDING', 'CLASSIFIED', 'NO_TEXT', 'ERROR', 'CONFIRMED', 'CORRECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `confirmed_type_id` CHAR(36) NULL,
    `confirmed_category` TEXT NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_note` TEXT NULL,
    `provider` TEXT NULL,
    `model` TEXT NULL,
    `error_message` TEXT NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_document_classifications_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `ai_document_classifications_tenant_id_status_reviewed_at_idx`(`tenant_id`, `status`, `reviewed_at`),
    INDEX `ai_document_classifications_tenant_id_document_id_idx`(`tenant_id`, `document_id`),
    UNIQUE INDEX `ai_document_classifications_tenant_id_document_version_id_key`(`tenant_id`, `document_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integrations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `category` ENUM('PAYMENT_GATEWAY', 'ACCOUNTING', 'LMS', 'BIOMETRIC', 'RFID', 'IDENTITY_PROVIDER', 'DOCUMENT_SERVICE', 'SMS', 'WHATSAPP', 'EMAIL') NOT NULL,
    `provider` TEXT NOT NULL,
    `direction` ENUM('OUTBOUND', 'INBOUND', 'BIDIRECTIONAL') NOT NULL DEFAULT 'OUTBOUND',
    `description` TEXT NULL,
    `config` JSON NULL,
    `credentials_encrypted` TEXT NULL,
    `retry_policy` JSON NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'DRAFT',
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `health_status` ENUM('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY') NOT NULL DEFAULT 'UNKNOWN',
    `last_tested_at` DATETIME(3) NULL,
    `last_test_succeeded_at` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,
    `consecutive_failures` INTEGER NOT NULL DEFAULT 0,
    `last_error_message` TEXT NULL,
    `last_latency_ms` INTEGER NULL,
    `sync_cursor` TEXT NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `integrations_tenant_id_category_status_idx`(`tenant_id`, `category`, `status`),
    INDEX `integrations_tenant_id_status_is_default_idx`(`tenant_id`, `status`, `is_default`),
    INDEX `integrations_tenant_id_health_status_idx`(`tenant_id`, `health_status`),
    UNIQUE INDEX `integrations_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_webhook_endpoints` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `path_token` VARCHAR(512) NOT NULL,
    `eventTypes` JSON NOT NULL,
    `secret_encrypted` TEXT NOT NULL,
    `signatureHeader` VARCHAR(255) NOT NULL DEFAULT 'x-integration-signature',
    `signature_algorithm` ENUM('HMAC_SHA256', 'HMAC_SHA256_TS', 'HMAC_SHA256_PREFIXED', 'BEARER_TOKEN') NOT NULL DEFAULT 'HMAC_SHA256',
    `signature_tolerance_secs` INTEGER NOT NULL DEFAULT 300,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_event_at` DATETIME(3) NULL,
    `event_count` INTEGER NOT NULL DEFAULT 0,
    `failure_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `integration_webhook_endpoints_path_token_key`(`path_token`),
    INDEX `integration_webhook_endpoints_tenant_id_is_active_idx`(`tenant_id`, `is_active`),
    UNIQUE INDEX `integration_webhook_endpoints_integration_id_name_key`(`integration_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_webhook_events` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NULL,
    `webhook_endpoint_id` CHAR(36) NOT NULL,
    `external_event_id` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `status` ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `signature_verified` BOOLEAN NOT NULL DEFAULT false,
    `payload` JSON NULL,
    `headers` JSON NULL,
    `response_status` INTEGER NULL,
    `error_message` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    INDEX `integration_webhook_events_tenant_id_status_received_at_idx`(`tenant_id`, `status`, `received_at`),
    INDEX `integration_webhook_events_tenant_id_eventType_received_at_idx`(`tenant_id`, `eventType`, `received_at`),
    INDEX `integration_webhook_events_tenant_id_integration_id_idx`(`tenant_id`, `integration_id`),
    UNIQUE INDEX `integration_webhook_events_webhook_endpoint_id_external_even_key`(`webhook_endpoint_id`, `external_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_operations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `idempotency_key` VARCHAR(191) NULL,
    `request` JSON NULL,
    `response` JSON NULL,
    `error_message` TEXT NULL,
    `failure_category` ENUM('AUTHENTICATION', 'CONFIGURATION', 'NETWORK', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_REJECTED', 'SIGNATURE', 'SCHEMA', 'UNKNOWN') NULL,
    `retryable` BOOLEAN NOT NULL DEFAULT false,
    `next_retry_at` DATETIME(3) NULL,
    `latency_ms` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `integration_operations_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `integration_operations_tenant_id_integration_id_operation_idx`(`tenant_id`, `integration_id`, `operation`),
    INDEX `integration_operations_status_next_retry_at_idx`(`status`, `next_retry_at`),
    UNIQUE INDEX `integration_operations_integration_id_idempotency_key_key`(`integration_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_sync_runs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NOT NULL,
    `direction` ENUM('OUTBOUND', 'INBOUND', 'BIDIRECTIONAL') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `trigger` ENUM('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY') NOT NULL DEFAULT 'MANUAL',
    `scope` JSON NULL,
    `cursor_before` TEXT NULL,
    `cursor_after` TEXT NULL,
    `attempted` INTEGER NOT NULL DEFAULT 0,
    `succeeded` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `has_more` BOOLEAN NOT NULL DEFAULT false,
    `requested_by` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_sync_runs_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `integration_sync_runs_tenant_id_integration_id_created_at_idx`(`tenant_id`, `integration_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_sync_records` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NOT NULL,
    `sync_run_id` CHAR(36) NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `external_id` VARCHAR(191) NOT NULL,
    `internal_id` TEXT NULL,
    `content_hash` TEXT NULL,
    `payload` JSON NULL,
    `status` ENUM('IN_SYNC', 'PENDING', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `integration_sync_records_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `integration_sync_records_tenant_id_integration_id_entity_typ_idx`(`tenant_id`, `integration_id`, `entity_type`),
    INDEX `integration_sync_records_sync_run_id_idx`(`sync_run_id`),
    UNIQUE INDEX `integration_sync_records_integration_id_entity_type_external_key`(`integration_id`, `entity_type`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_failures` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `integration_id` CHAR(36) NULL,
    `operation_id` CHAR(36) NULL,
    `webhook_event_id` CHAR(36) NULL,
    `sync_run_id` CHAR(36) NULL,
    `category` ENUM('AUTHENTICATION', 'CONFIGURATION', 'NETWORK', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_REJECTED', 'SIGNATURE', 'SCHEMA', 'UNKNOWN') NOT NULL,
    `retryable` BOOLEAN NOT NULL DEFAULT false,
    `provider_code` TEXT NULL,
    `message` TEXT NOT NULL,
    `details` JSON NULL,
    `occurrences` INTEGER NOT NULL DEFAULT 1,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` TEXT NULL,
    `resolution_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_failures_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `integration_failures_tenant_id_category_resolved_at_idx`(`tenant_id`, `category`, `resolved_at`),
    INDEX `integration_failures_tenant_id_integration_id_created_at_idx`(`tenant_id`, `integration_id`, `created_at`),
    INDEX `integration_failures_resolved_at_idx`(`resolved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `format` ENUM('CSV', 'XLSX') NOT NULL,
    `status` ENUM('PENDING', 'VALIDATING', 'VALIDATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `mode` VARCHAR(255) NOT NULL DEFAULT 'COMMIT',
    `file_name` TEXT NOT NULL,
    `storage_key` TEXT NOT NULL,
    `size_bytes` INTEGER NOT NULL DEFAULT 0,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `processed_rows` INTEGER NOT NULL DEFAULT 0,
    `valid_rows` INTEGER NOT NULL DEFAULT 0,
    `invalid_rows` INTEGER NOT NULL DEFAULT 0,
    `duplicate_rows` INTEGER NOT NULL DEFAULT 0,
    `skipped_rows` INTEGER NOT NULL DEFAULT 0,
    `inserted_rows` INTEGER NOT NULL DEFAULT 0,
    `updated_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `mapping` JSON NULL,
    `options` JSON NULL,
    `error_summary` JSON NULL,
    `message` TEXT NULL,
    `requested_by_id` CHAR(36) NULL,
    `retry_of_id` CHAR(36) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_jobs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `import_jobs_tenant_id_entity_type_created_at_idx`(`tenant_id`, `entity_type`, `created_at`),
    INDEX `import_jobs_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_job_rows` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `status` ENUM('VALID', 'INVALID', 'DUPLICATE', 'SKIPPED', 'INSERTED', 'UPDATED', 'FAILED') NOT NULL,
    `source_key` TEXT NULL,
    `raw_data` JSON NULL,
    `mapped_data` JSON NULL,
    `errors` JSON NULL,
    `message` TEXT NULL,
    `target_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_job_rows_tenant_id_job_id_status_idx`(`tenant_id`, `job_id`, `status`),
    UNIQUE INDEX `import_job_rows_job_id_row_number_key`(`job_id`, `row_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_templates` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `mapping` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_templates_tenant_id_entity_type_idx`(`tenant_id`, `entity_type`),
    UNIQUE INDEX `import_templates_tenant_id_entity_type_name_key`(`tenant_id`, `entity_type`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_histories` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `query` VARCHAR(191) NOT NULL,
    `types` JSON NOT NULL,
    `result_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_searched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `search_histories_tenant_id_user_id_last_searched_at_idx`(`tenant_id`, `user_id`, `last_searched_at`),
    UNIQUE INDEX `search_histories_tenant_id_user_id_query_key`(`tenant_id`, `user_id`, `query`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `background_jobs` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `queue` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `bull_job_id` VARCHAR(512) NULL,
    `tenant_id` CHAR(36) NULL,
    `status` ENUM('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD_LETTERED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `attempts_made` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 1,
    `idempotency_key` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `enqueued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `background_jobs_queue_status_idx`(`queue`, `status`),
    INDEX `background_jobs_tenant_id_idx`(`tenant_id`),
    INDEX `background_jobs_bull_job_id_idx`(`bull_job_id`),
    INDEX `background_jobs_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `background_jobs_queue_idempotency_key_key`(`queue`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generated_documents` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` TEXT NULL,
    `status` ENUM('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD_LETTERED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `input` JSON NOT NULL,
    `storage_key` TEXT NULL,
    `content_type` TEXT NULL,
    `byte_size` INTEGER NULL,
    `error_message` TEXT NULL,
    `requested_by_id` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `generated_documents_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `generated_documents_tenant_id_kind_idx`(`tenant_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_providers` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `protocol` ENUM('OIDC') NOT NULL DEFAULT 'OIDC',
    `status` ENUM('DRAFT', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'DRAFT',
    `issuer` TEXT NOT NULL,
    `discovery_url` TEXT NULL,
    `client_id` TEXT NOT NULL,
    `client_secret_encrypted` TEXT NULL,
    `scopes` JSON NOT NULL,
    `allowed_email_domains` JSON NOT NULL,
    `auto_provision_users` BOOLEAN NOT NULL DEFAULT true,
    `default_role_id` CHAR(36) NULL,
    `enforce_email_verified` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,
    `created_by` TEXT NULL,
    `updated_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `identity_providers_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `identity_providers_tenant_id_key_key`(`tenant_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `external_identities` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `identity_provider_id` CHAR(36) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `email` TEXT NULL,
    `claims` JSON NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `external_identities_tenant_id_user_id_idx`(`tenant_id`, `user_id`),
    UNIQUE INDEX `external_identities_identity_provider_id_subject_key`(`identity_provider_id`, `subject`),
    UNIQUE INDEX `external_identities_user_id_identity_provider_id_key`(`user_id`, `identity_provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `identity_provider_role_mappings` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `tenant_id` CHAR(36) NOT NULL,
    `identity_provider_id` CHAR(36) NOT NULL,
    `claim_name` VARCHAR(191) NOT NULL DEFAULT 'groups',
    `claim_value` VARCHAR(191) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `created_by` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `identity_provider_role_mappings_tenant_id_identity_provider__idx`(`tenant_id`, `identity_provider_id`),
    UNIQUE INDEX `identity_provider_role_mappings_identity_provider_id_claim_n_key`(`identity_provider_id`, `claim_name`, `claim_value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_sessions` (
    `id` VARCHAR(512) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `tenant_slug` TEXT NULL,
    `tenant_name` TEXT NULL,
    `status` ENUM('IN_PROGRESS', 'COMPLETED', 'ABANDONED') NOT NULL DEFAULT 'IN_PROGRESS',
    `current_step` INTEGER NOT NULL DEFAULT 1,
    `completed_steps` JSON NOT NULL,
    `account_email` TEXT NOT NULL,
    `account_full_name` TEXT NOT NULL,
    `account_password_hash` TEXT NOT NULL,
    `admin_user_id` CHAR(36) NULL,
    `admin_email` TEXT NULL,
    `admin_full_name` TEXT NULL,
    `plan_code` TEXT NULL,
    `data` JSON NOT NULL,
    `token_hash` VARCHAR(512) NOT NULL,
    `ip_address` TEXT NULL,
    `user_agent` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `onboarding_sessions_token_hash_key`(`token_hash`),
    INDEX `onboarding_sessions_tenant_id_idx`(`tenant_id`),
    INDEX `onboarding_sessions_status_idx`(`status`),
    INDEX `onboarding_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_databases` ADD CONSTRAINT `tenant_databases_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_items` ADD CONSTRAINT `subscription_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_items` ADD CONSTRAINT `subscription_items_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_feature_flags` ADD CONSTRAINT `plan_feature_flags_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_feature_flags` ADD CONSTRAINT `plan_feature_flags_feature_flag_id_fkey` FOREIGN KEY (`feature_flag_id`) REFERENCES `feature_flags`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_modules` ADD CONSTRAINT `plan_modules_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_flags` ADD CONSTRAINT `tenant_feature_flags_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_flags` ADD CONSTRAINT `tenant_feature_flags_feature_flag_id_fkey` FOREIGN KEY (`feature_flag_id`) REFERENCES `feature_flags`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `usage_events` ADD CONSTRAINT `usage_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entitlements` ADD CONSTRAINT `entitlements_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_line_items` ADD CONSTRAINT `invoice_line_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_line_items` ADD CONSTRAINT `invoice_line_items_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_comments` ADD CONSTRAINT `support_ticket_comments_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_audit_logs` ADD CONSTRAINT `platform_audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_sessions` ADD CONSTRAINT `platform_sessions_platform_user_id_fkey` FOREIGN KEY (`platform_user_id`) REFERENCES `platform_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_campus_id_fkey` FOREIGN KEY (`scope_campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_department_id_fkey` FOREIGN KEY (`scope_department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_program_id_fkey` FOREIGN KEY (`scope_program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `login_events` ADD CONSTRAINT `login_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `login_events` ADD CONSTRAINT `login_events_identity_provider_id_fkey` FOREIGN KEY (`identity_provider_id`) REFERENCES `identity_providers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mfa_backup_codes` ADD CONSTRAINT `mfa_backup_codes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mfa_backup_codes` ADD CONSTRAINT `mfa_backup_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_mfa_backup_codes` ADD CONSTRAINT `platform_mfa_backup_codes_platform_user_id_fkey` FOREIGN KEY (`platform_user_id`) REFERENCES `platform_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_history` ADD CONSTRAINT `password_history_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_history` ADD CONSTRAINT `password_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_events` ADD CONSTRAINT `security_events_platform_user_id_fkey` FOREIGN KEY (`platform_user_id`) REFERENCES `platform_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_security_settings` ADD CONSTRAINT `tenant_security_settings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_configurations` ADD CONSTRAINT `tenant_configurations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campus_configurations` ADD CONSTRAINT `campus_configurations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campus_configurations` ADD CONSTRAINT `campus_configurations_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campuses` ADD CONSTRAINT `campuses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programs` ADD CONSTRAINT `programs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programs` ADD CONSTRAINT `programs_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_years` ADD CONSTRAINT `academic_years_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terms` ADD CONSTRAINT `terms_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terms` ADD CONSTRAINT `terms_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_building_id_fkey` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buildings` ADD CONSTRAINT `buildings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buildings` ADD CONSTRAINT `buildings_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batches` ADD CONSTRAINT `batches_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batches` ADD CONSTRAINT `batches_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batches` ADD CONSTRAINT `batches_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `notification_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `notification_campaigns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_templates` ADD CONSTRAINT `notification_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_campaigns` ADD CONSTRAINT `notification_campaigns_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_campaigns` ADD CONSTRAINT `notification_campaigns_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_delivery_logs` ADD CONSTRAINT `notification_delivery_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_delivery_logs` ADD CONSTRAINT `notification_delivery_logs_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_provider_configs` ADD CONSTRAINT `notification_provider_configs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_event_triggers` ADD CONSTRAINT `notification_event_triggers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_event_triggers` ADD CONSTRAINT `notification_event_triggers_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_push_devices` ADD CONSTRAINT `user_push_devices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_push_devices` ADD CONSTRAINT `user_push_devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_types` ADD CONSTRAINT `document_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_document_type_id_fkey` FOREIGN KEY (`document_type_id`) REFERENCES `document_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `document_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_access_grants` ADD CONSTRAINT `document_access_grants_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_access_grants` ADD CONSTRAINT `document_access_grants_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_download_logs` ADD CONSTRAINT `document_download_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_download_logs` ADD CONSTRAINT `document_download_logs_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_definitions` ADD CONSTRAINT `workflow_definitions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_states` ADD CONSTRAINT `workflow_states_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_states` ADD CONSTRAINT `workflow_states_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `workflow_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transitions` ADD CONSTRAINT `workflow_transitions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transitions` ADD CONSTRAINT `workflow_transitions_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `workflow_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transitions` ADD CONSTRAINT `workflow_transitions_from_state_id_fkey` FOREIGN KEY (`from_state_id`) REFERENCES `workflow_states`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transitions` ADD CONSTRAINT `workflow_transitions_to_state_id_fkey` FOREIGN KEY (`to_state_id`) REFERENCES `workflow_states`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transition_approvers` ADD CONSTRAINT `workflow_transition_approvers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_transition_approvers` ADD CONSTRAINT `workflow_transition_approvers_transition_id_fkey` FOREIGN KEY (`transition_id`) REFERENCES `workflow_transitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `workflow_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_instances` ADD CONSTRAINT `workflow_instances_current_state_id_fkey` FOREIGN KEY (`current_state_id`) REFERENCES `workflow_states`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_approval_tasks` ADD CONSTRAINT `workflow_approval_tasks_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_approval_tasks` ADD CONSTRAINT `workflow_approval_tasks_instance_id_fkey` FOREIGN KEY (`instance_id`) REFERENCES `workflow_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_approval_tasks` ADD CONSTRAINT `workflow_approval_tasks_transition_id_fkey` FOREIGN KEY (`transition_id`) REFERENCES `workflow_transitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_approval_tasks` ADD CONSTRAINT `workflow_approval_tasks_approver_slot_id_fkey` FOREIGN KEY (`approver_slot_id`) REFERENCES `workflow_transition_approvers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_documents` ADD CONSTRAINT `student_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_documents` ADD CONSTRAINT `student_documents_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_admissions` ADD CONSTRAINT `student_admissions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_admissions` ADD CONSTRAINT `student_admissions_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_admissions` ADD CONSTRAINT `student_admissions_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_admissions` ADD CONSTRAINT `student_admissions_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_academic_records` ADD CONSTRAINT `student_academic_records_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_academic_records` ADD CONSTRAINT `student_academic_records_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_enrollments` ADD CONSTRAINT `student_enrollments_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_attendance` ADD CONSTRAINT `student_attendance_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_timetable_entry_id_fkey` FOREIGN KEY (`timetable_entry_id`) REFERENCES `timetable_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `attendance_correction_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `attendance_correction_requests_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `attendance_correction_requests_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `attendance_correction_requests_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_correction_requests` ADD CONSTRAINT `attendance_correction_requests_decided_by_user_id_fkey` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_attendance` ADD CONSTRAINT `faculty_attendance_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_attendance` ADD CONSTRAINT `faculty_attendance_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_attendance` ADD CONSTRAINT `faculty_attendance_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_devices` ADD CONSTRAINT `attendance_devices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_devices` ADD CONSTRAINT `attendance_devices_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_users` ADD CONSTRAINT `attendance_device_users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_users` ADD CONSTRAINT `attendance_device_users_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `attendance_devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_users` ADD CONSTRAINT `attendance_device_users_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_users` ADD CONSTRAINT `attendance_device_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_logs` ADD CONSTRAINT `attendance_device_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_logs` ADD CONSTRAINT `attendance_device_logs_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `attendance_devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_logs` ADD CONSTRAINT `attendance_device_logs_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_logs` ADD CONSTRAINT `attendance_device_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_device_logs` ADD CONSTRAINT `attendance_device_logs_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `fee_structures`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_structure_line_id_fkey` FOREIGN KEY (`structure_line_id`) REFERENCES `fee_structure_lines`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `fee_demands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_hostel_booking_id_fkey` FOREIGN KEY (`hostel_booking_id`) REFERENCES `student_hostel_bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fees` ADD CONSTRAINT `student_fees_transport_pass_id_fkey` FOREIGN KEY (`transport_pass_id`) REFERENCES `student_transport_passes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_payments` ADD CONSTRAINT `student_payments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_payments` ADD CONSTRAINT `student_payments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_payments` ADD CONSTRAINT `student_payments_student_fee_id_fkey` FOREIGN KEY (`student_fee_id`) REFERENCES `student_fees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_allocations` ADD CONSTRAINT `student_fee_allocations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_allocations` ADD CONSTRAINT `student_fee_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `student_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_allocations` ADD CONSTRAINT `student_fee_allocations_student_fee_id_fkey` FOREIGN KEY (`student_fee_id`) REFERENCES `student_fees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_base_session_id_fkey` FOREIGN KEY (`base_session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_grading_scheme_id_fkey` FOREIGN KEY (`grading_scheme_id`) REFERENCES `grading_schemes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_subjects` ADD CONSTRAINT `exam_subjects_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_subjects` ADD CONSTRAINT `exam_subjects_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_subjects` ADD CONSTRAINT `exam_subjects_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_subjects` ADD CONSTRAINT `exam_subjects_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_eligibility_rules` ADD CONSTRAINT `exam_eligibility_rules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_eligibility_rules` ADD CONSTRAINT `exam_eligibility_rules_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_registrations` ADD CONSTRAINT `exam_registrations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_registrations` ADD CONSTRAINT `exam_registrations_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_registrations` ADD CONSTRAINT `exam_registrations_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_tickets` ADD CONSTRAINT `exam_hall_tickets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_tickets` ADD CONSTRAINT `exam_hall_tickets_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_tickets` ADD CONSTRAINT `exam_hall_tickets_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_ticket_subjects` ADD CONSTRAINT `exam_hall_ticket_subjects_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_ticket_subjects` ADD CONSTRAINT `exam_hall_ticket_subjects_hall_ticket_id_fkey` FOREIGN KEY (`hall_ticket_id`) REFERENCES `exam_hall_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_hall_ticket_subjects` ADD CONSTRAINT `exam_hall_ticket_subjects_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seating_plans` ADD CONSTRAINT `exam_seating_plans_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seating_plans` ADD CONSTRAINT `exam_seating_plans_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seating_plans` ADD CONSTRAINT `exam_seating_plans_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seating_plans` ADD CONSTRAINT `exam_seating_plans_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seat_allocations` ADD CONSTRAINT `exam_seat_allocations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seat_allocations` ADD CONSTRAINT `exam_seat_allocations_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `exam_seating_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seat_allocations` ADD CONSTRAINT `exam_seat_allocations_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_seat_allocations` ADD CONSTRAINT `exam_seat_allocations_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_invigilator_assignments` ADD CONSTRAINT `exam_invigilator_assignments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_invigilator_assignments` ADD CONSTRAINT `exam_invigilator_assignments_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_invigilator_assignments` ADD CONSTRAINT `exam_invigilator_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_invigilator_assignments` ADD CONSTRAINT `exam_invigilator_assignments_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks_entries` ADD CONSTRAINT `exam_marks_entries_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks_entries` ADD CONSTRAINT `exam_marks_entries_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks_entries` ADD CONSTRAINT `exam_marks_entries_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_marks_entries` ADD CONSTRAINT `exam_marks_entries_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_revaluation_requests` ADD CONSTRAINT `exam_revaluation_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_revaluation_requests` ADD CONSTRAINT `exam_revaluation_requests_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_revaluation_requests` ADD CONSTRAINT `exam_revaluation_requests_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_revaluation_requests` ADD CONSTRAINT `exam_revaluation_requests_marks_entry_id_fkey` FOREIGN KEY (`marks_entry_id`) REFERENCES `exam_marks_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grading_schemes` ADD CONSTRAINT `grading_schemes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_scales` ADD CONSTRAINT `grade_scales_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_scales` ADD CONSTRAINT `grade_scales_scheme_id_fkey` FOREIGN KEY (`scheme_id`) REFERENCES `grading_schemes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_components` ADD CONSTRAINT `assessment_components_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_components` ADD CONSTRAINT `assessment_components_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_components` ADD CONSTRAINT `assessment_components_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_component_marks` ADD CONSTRAINT `exam_component_marks_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_component_marks` ADD CONSTRAINT `exam_component_marks_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_component_marks` ADD CONSTRAINT `exam_component_marks_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_component_marks` ADD CONSTRAINT `exam_component_marks_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `assessment_components`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_component_marks` ADD CONSTRAINT `exam_component_marks_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `exam_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `exam_subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_marks_entry_id_fkey` FOREIGN KEY (`marks_entry_id`) REFERENCES `exam_marks_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `student_exams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_calculations` ADD CONSTRAINT `result_calculations_process_id_fkey` FOREIGN KEY (`process_id`) REFERENCES `result_processes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_processes` ADD CONSTRAINT `result_processes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_processes` ADD CONSTRAINT `result_processes_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_processes` ADD CONSTRAINT `result_processes_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_processes` ADD CONSTRAINT `result_processes_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `student_exams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_history` ADD CONSTRAINT `result_history_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_history` ADD CONSTRAINT `result_history_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_history` ADD CONSTRAINT `result_history_process_id_fkey` FOREIGN KEY (`process_id`) REFERENCES `result_processes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_history` ADD CONSTRAINT `result_history_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_heads` ADD CONSTRAINT `fee_heads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_lines` ADD CONSTRAINT `fee_structure_lines_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_lines` ADD CONSTRAINT `fee_structure_lines_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `fee_structures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_lines` ADD CONSTRAINT `fee_structure_lines_head_id_fkey` FOREIGN KEY (`head_id`) REFERENCES `fee_heads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_assignments` ADD CONSTRAINT `student_fee_assignments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_assignments` ADD CONSTRAINT `student_fee_assignments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_assignments` ADD CONSTRAINT `student_fee_assignments_structure_id_fkey` FOREIGN KEY (`structure_id`) REFERENCES `fee_structures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_fee_assignments` ADD CONSTRAINT `student_fee_assignments_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_demands` ADD CONSTRAINT `fee_demands_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_demands` ADD CONSTRAINT `fee_demands_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `student_fee_assignments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_demands` ADD CONSTRAINT `fee_demands_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_demands` ADD CONSTRAINT `fee_demands_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `fee_demands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_student_fee_id_fkey` FOREIGN KEY (`student_fee_id`) REFERENCES `student_fees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_concessions` ADD CONSTRAINT `fee_concessions_head_id_fkey` FOREIGN KEY (`head_id`) REFERENCES `fee_heads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_refunds` ADD CONSTRAINT `fee_refunds_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_refunds` ADD CONSTRAINT `fee_refunds_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_refunds` ADD CONSTRAINT `fee_refunds_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `student_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_sequences` ADD CONSTRAINT `fee_sequences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_exams` ADD CONSTRAINT `student_exams_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_results` ADD CONSTRAINT `student_results_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_results` ADD CONSTRAINT `student_results_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_results` ADD CONSTRAINT `student_results_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `student_exams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_results` ADD CONSTRAINT `student_results_result_calculation_id_fkey` FOREIGN KEY (`result_calculation_id`) REFERENCES `result_calculations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `certificate_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_certificates` ADD CONSTRAINT `student_certificates_reissued_from_id_fkey` FOREIGN KEY (`reissued_from_id`) REFERENCES `student_certificates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificate_templates` ADD CONSTRAINT `certificate_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificate_history_rows` ADD CONSTRAINT `certificate_history_rows_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificate_history_rows` ADD CONSTRAINT `certificate_history_rows_certificate_id_fkey` FOREIGN KEY (`certificate_id`) REFERENCES `student_certificates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_library_loans` ADD CONSTRAINT `student_library_loans_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_library_loans` ADD CONSTRAINT `student_library_loans_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_library_loans` ADD CONSTRAINT `student_library_loans_copy_id_fkey` FOREIGN KEY (`copy_id`) REFERENCES `library_copies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_library_loans` ADD CONSTRAINT `student_library_loans_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `library_members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostels` ADD CONSTRAINT `hostels_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostels` ADD CONSTRAINT `hostels_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostels` ADD CONSTRAINT `hostels_fee_head_id_fkey` FOREIGN KEY (`fee_head_id`) REFERENCES `fee_heads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_buildings` ADD CONSTRAINT `hostel_buildings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_buildings` ADD CONSTRAINT `hostel_buildings_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_floors` ADD CONSTRAINT `hostel_floors_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_floors` ADD CONSTRAINT `hostel_floors_building_id_fkey` FOREIGN KEY (`building_id`) REFERENCES `hostel_buildings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_rooms` ADD CONSTRAINT `hostel_rooms_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_rooms` ADD CONSTRAINT `hostel_rooms_floor_id_fkey` FOREIGN KEY (`floor_id`) REFERENCES `hostel_floors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_beds` ADD CONSTRAINT `hostel_beds_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_beds` ADD CONSTRAINT `hostel_beds_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_wardens` ADD CONSTRAINT `hostel_wardens_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_wardens` ADD CONSTRAINT `hostel_wardens_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_complaints` ADD CONSTRAINT `hostel_complaints_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_visitors` ADD CONSTRAINT `hostel_visitors_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_visitors` ADD CONSTRAINT `hostel_visitors_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hostel_visitors` ADD CONSTRAINT `hostel_visitors_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_hostel_id_fkey` FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_building_id_fkey` FOREIGN KEY (`building_id`) REFERENCES `hostel_buildings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_floor_id_fkey` FOREIGN KEY (`floor_id`) REFERENCES `hostel_floors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_bed_id_fkey` FOREIGN KEY (`bed_id`) REFERENCES `hostel_beds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_hostel_bookings` ADD CONSTRAINT `student_hostel_bookings_previous_booking_id_fkey` FOREIGN KEY (`previous_booking_id`) REFERENCES `student_hostel_bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_stop_id_fkey` FOREIGN KEY (`stop_id`) REFERENCES `transport_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_drop_stop_id_fkey` FOREIGN KEY (`drop_stop_id`) REFERENCES `transport_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_transport_passes` ADD CONSTRAINT `student_transport_passes_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `transport_drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_holds` ADD CONSTRAINT `student_holds_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_holds` ADD CONSTRAINT `student_holds_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_status_history` ADD CONSTRAINT `student_status_history_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_status_history` ADD CONSTRAINT `student_status_history_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_communications` ADD CONSTRAINT `student_communications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_communications` ADD CONSTRAINT `student_communications_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_activities` ADD CONSTRAINT `student_activities_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_activities` ADD CONSTRAINT `student_activities_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_sessions` ADD CONSTRAINT `admission_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_sessions` ADD CONSTRAINT `admission_sessions_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_program_offers` ADD CONSTRAINT `admission_program_offers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_program_offers` ADD CONSTRAINT `admission_program_offers_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `admission_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_program_offers` ADD CONSTRAINT `admission_program_offers_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_enquiries` ADD CONSTRAINT `admission_enquiries_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_enquiries` ADD CONSTRAINT `admission_enquiries_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `admission_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_enquiries` ADD CONSTRAINT `admission_enquiries_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `admission_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_admission_program_id_fkey` FOREIGN KEY (`admission_program_id`) REFERENCES `admission_program_offers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `admission_enquiries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_duplicate_of_id_fkey` FOREIGN KEY (`duplicate_of_id`) REFERENCES `admission_applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_counselling_slot_id_fkey` FOREIGN KEY (`counselling_slot_id`) REFERENCES `admission_counselling_slots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_applications` ADD CONSTRAINT `admission_applications_enrolled_student_id_fkey` FOREIGN KEY (`enrolled_student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_documents` ADD CONSTRAINT `admission_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_documents` ADD CONSTRAINT `admission_documents_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_qualifications` ADD CONSTRAINT `admission_qualifications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_qualifications` ADD CONSTRAINT `admission_qualifications_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_counselling_slots` ADD CONSTRAINT `admission_counselling_slots_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_counselling_slots` ADD CONSTRAINT `admission_counselling_slots_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `admission_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_counselling_slots` ADD CONSTRAINT `admission_counselling_slots_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_offers` ADD CONSTRAINT `admission_offers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_offers` ADD CONSTRAINT `admission_offers_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_fee_payments` ADD CONSTRAINT `admission_fee_payments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_fee_payments` ADD CONSTRAINT `admission_fee_payments_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_activities` ADD CONSTRAINT `admission_activities_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_activities` ADD CONSTRAINT `admission_activities_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_form_fields` ADD CONSTRAINT `admission_form_fields_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_form_fields` ADD CONSTRAINT `admission_form_fields_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `admission_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_eligibility_rules` ADD CONSTRAINT `admission_eligibility_rules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_eligibility_rules` ADD CONSTRAINT `admission_eligibility_rules_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `admission_program_offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_messages` ADD CONSTRAINT `admission_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admission_messages` ADD CONSTRAINT `admission_messages_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `admission_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courses` ADD CONSTRAINT `courses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courses` ADD CONSTRAINT `courses_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_prerequisites` ADD CONSTRAINT `course_prerequisites_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_prerequisites` ADD CONSTRAINT `course_prerequisites_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_prerequisites` ADD CONSTRAINT `course_prerequisites_required_course_id_fkey` FOREIGN KEY (`required_course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curricula` ADD CONSTRAINT `curricula_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curricula` ADD CONSTRAINT `curricula_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_versions` ADD CONSTRAINT `curriculum_versions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_versions` ADD CONSTRAINT `curriculum_versions_curriculum_id_fkey` FOREIGN KEY (`curriculum_id`) REFERENCES `curricula`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_courses` ADD CONSTRAINT `curriculum_courses_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_courses` ADD CONSTRAINT `curriculum_courses_curriculum_version_id_fkey` FOREIGN KEY (`curriculum_version_id`) REFERENCES `curriculum_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_courses` ADD CONSTRAINT `curriculum_courses_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offering_faculty` ADD CONSTRAINT `course_offering_faculty_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offering_faculty` ADD CONSTRAINT `course_offering_faculty_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offering_faculty` ADD CONSTRAINT `course_offering_faculty_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_registrations` ADD CONSTRAINT `course_registrations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_registrations` ADD CONSTRAINT `course_registrations_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_registrations` ADD CONSTRAINT `course_registrations_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_registrations` ADD CONSTRAINT `course_registrations_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_advising_records` ADD CONSTRAINT `academic_advising_records_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_advising_records` ADD CONSTRAINT `academic_advising_records_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_advising_records` ADD CONSTRAINT `academic_advising_records_advisor_user_id_fkey` FOREIGN KEY (`advisor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_advising_records` ADD CONSTRAINT `academic_advising_records_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_progression_records` ADD CONSTRAINT `academic_progression_records_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_progression_records` ADD CONSTRAINT `academic_progression_records_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_progression_records` ADD CONSTRAINT `academic_progression_records_program_id_fkey` FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_progression_records` ADD CONSTRAINT `academic_progression_records_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_progression_records` ADD CONSTRAINT `academic_progression_records_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `course_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_backlogs` ADD CONSTRAINT `course_backlogs_cleared_in_registration_id_fkey` FOREIGN KEY (`cleared_in_registration_id`) REFERENCES `course_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_calendar_events` ADD CONSTRAINT `academic_calendar_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_calendar_events` ADD CONSTRAINT `academic_calendar_events_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `academic_calendar_events` ADD CONSTRAINT `academic_calendar_events_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetables` ADD CONSTRAINT `timetables_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetables` ADD CONSTRAINT `timetables_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetables` ADD CONSTRAINT `timetables_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetables` ADD CONSTRAINT `timetables_published_by_id_fkey` FOREIGN KEY (`published_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_periods` ADD CONSTRAINT `timetable_periods_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_periods` ADD CONSTRAINT `timetable_periods_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `timetable_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_entries` ADD CONSTRAINT `timetable_entries_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_holidays` ADD CONSTRAINT `timetable_holidays_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_holidays` ADD CONSTRAINT `timetable_holidays_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_availability` ADD CONSTRAINT `faculty_availability_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_availability` ADD CONSTRAINT `faculty_availability_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_conflicts` ADD CONSTRAINT `timetable_conflicts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_conflicts` ADD CONSTRAINT `timetable_conflicts_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_entry_id_fkey` FOREIGN KEY (`entry_id`) REFERENCES `timetable_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_substitutions` ADD CONSTRAINT `timetable_substitutions_substitute_user_id_fkey` FOREIGN KEY (`substitute_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_history` ADD CONSTRAINT `timetable_history_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timetable_history` ADD CONSTRAINT `timetable_history_timetable_id_fkey` FOREIGN KEY (`timetable_id`) REFERENCES `timetables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_categories` ADD CONSTRAINT `library_categories_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_categories` ADD CONSTRAINT `library_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `library_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_publishers` ADD CONSTRAINT `library_publishers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_authors` ADD CONSTRAINT `library_authors_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_books` ADD CONSTRAINT `library_books_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_books` ADD CONSTRAINT `library_books_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `library_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_books` ADD CONSTRAINT `library_books_publisher_id_fkey` FOREIGN KEY (`publisher_id`) REFERENCES `library_publishers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_book_authors` ADD CONSTRAINT `library_book_authors_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_book_authors` ADD CONSTRAINT `library_book_authors_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_book_authors` ADD CONSTRAINT `library_book_authors_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `library_authors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_copies` ADD CONSTRAINT `library_copies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_copies` ADD CONSTRAINT `library_copies_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_members` ADD CONSTRAINT `library_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_members` ADD CONSTRAINT `library_members_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_members` ADD CONSTRAINT `library_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `library_books`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_copy_id_fkey` FOREIGN KEY (`copy_id`) REFERENCES `library_copies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_reservations` ADD CONSTRAINT `library_reservations_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `library_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `student_library_loans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_fines` ADD CONSTRAINT `library_fines_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `library_members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_transactions` ADD CONSTRAINT `library_transactions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_transactions` ADD CONSTRAINT `library_transactions_copy_id_fkey` FOREIGN KEY (`copy_id`) REFERENCES `library_copies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_transactions` ADD CONSTRAINT `library_transactions_loan_id_fkey` FOREIGN KEY (`loan_id`) REFERENCES `student_library_loans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_transactions` ADD CONSTRAINT `library_transactions_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `library_members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_configs` ADD CONSTRAINT `library_configs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_sequences` ADD CONSTRAINT `library_sequences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_vehicles` ADD CONSTRAINT `transport_vehicles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_vehicles` ADD CONSTRAINT `transport_vehicles_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_vehicle_documents` ADD CONSTRAINT `transport_vehicle_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_vehicle_documents` ADD CONSTRAINT `transport_vehicle_documents_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_drivers` ADD CONSTRAINT `transport_drivers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_drivers` ADD CONSTRAINT `transport_drivers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_driver_assignments` ADD CONSTRAINT `transport_driver_assignments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_driver_assignments` ADD CONSTRAINT `transport_driver_assignments_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `transport_drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_driver_assignments` ADD CONSTRAINT `transport_driver_assignments_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_stops` ADD CONSTRAINT `transport_stops_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_stops` ADD CONSTRAINT `transport_stops_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trips` ADD CONSTRAINT `transport_trips_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `transport_drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trip_stops` ADD CONSTRAINT `transport_trip_stops_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trip_stops` ADD CONSTRAINT `transport_trip_stops_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `transport_trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_trip_stops` ADD CONSTRAINT `transport_trip_stops_stop_id_fkey` FOREIGN KEY (`stop_id`) REFERENCES `transport_stops`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_maintenance_records` ADD CONSTRAINT `transport_maintenance_records_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_maintenance_records` ADD CONSTRAINT `transport_maintenance_records_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_gps_positions` ADD CONSTRAINT `transport_gps_positions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_gps_positions` ADD CONSTRAINT `transport_gps_positions_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_gps_positions` ADD CONSTRAINT `transport_gps_positions_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `transport_trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_alerts` ADD CONSTRAINT `transport_alerts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_alerts` ADD CONSTRAINT `transport_alerts_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `transport_vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_alerts` ADD CONSTRAINT `transport_alerts_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `transport_trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transport_gps_configs` ADD CONSTRAINT `transport_gps_configs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_designation_id_fkey` FOREIGN KEY (`designation_id`) REFERENCES `hr_designations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_reporting_to_id_fkey` FOREIGN KEY (`reporting_to_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_designations` ADD CONSTRAINT `hr_designations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_designations` ADD CONSTRAINT `hr_designations_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_joinings` ADD CONSTRAINT `employee_joinings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_joinings` ADD CONSTRAINT `employee_joinings_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_exits` ADD CONSTRAINT `employee_exits_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_exits` ADD CONSTRAINT `employee_exits_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_documents` ADD CONSTRAINT `employee_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_documents` ADD CONSTRAINT `employee_documents_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_documents` ADD CONSTRAINT `employee_documents_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_workloads` ADD CONSTRAINT `faculty_workloads_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_workloads` ADD CONSTRAINT `faculty_workloads_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faculty_workloads` ADD CONSTRAINT `faculty_workloads_term_id_fkey` FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_balances` ADD CONSTRAINT `leave_balances_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_balances` ADD CONSTRAINT `leave_balances_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_balances` ADD CONSTRAINT `leave_balances_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_applications` ADD CONSTRAINT `leave_applications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_applications` ADD CONSTRAINT `leave_applications_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_applications` ADD CONSTRAINT `leave_applications_leave_type_id_fkey` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leave_applications` ADD CONSTRAINT `leave_applications_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_performance_reviews` ADD CONSTRAINT `employee_performance_reviews_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_performance_reviews` ADD CONSTRAINT `employee_performance_reviews_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_performance_reviews` ADD CONSTRAINT `employee_performance_reviews_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structures` ADD CONSTRAINT `salary_structures_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_structures` ADD CONSTRAINT `salary_structures_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_processed_by_user_id_fkey` FOREIGN KEY (`processed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_lines` ADD CONSTRAINT `payroll_run_lines_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_lines` ADD CONSTRAINT `payroll_run_lines_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_lines` ADD CONSTRAINT `payroll_run_lines_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_lines` ADD CONSTRAINT `payroll_run_lines_salary_structure_id_fkey` FOREIGN KEY (`salary_structure_id`) REFERENCES `salary_structures`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_run_lines` ADD CONSTRAINT `payroll_run_lines_payslip_document_id_fkey` FOREIGN KEY (`payslip_document_id`) REFERENCES `employee_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_companies` ADD CONSTRAINT `placement_companies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_contacts` ADD CONSTRAINT `placement_contacts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_contacts` ADD CONSTRAINT `placement_contacts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `placement_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_drives` ADD CONSTRAINT `placement_drives_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_drives` ADD CONSTRAINT `placement_drives_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `placement_companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_drives` ADD CONSTRAINT `placement_drives_coordinator_contact_id_fkey` FOREIGN KEY (`coordinator_contact_id`) REFERENCES `placement_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_positions` ADD CONSTRAINT `placement_positions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_positions` ADD CONSTRAINT `placement_positions_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_eligibility` ADD CONSTRAINT `placement_eligibility_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_eligibility` ADD CONSTRAINT `placement_eligibility_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_eligibility` ADD CONSTRAINT `placement_eligibility_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `placement_positions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_eligibility` ADD CONSTRAINT `placement_eligibility_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_resumes` ADD CONSTRAINT `placement_resumes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_resumes` ADD CONSTRAINT `placement_resumes_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_applications` ADD CONSTRAINT `placement_applications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_applications` ADD CONSTRAINT `placement_applications_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_applications` ADD CONSTRAINT `placement_applications_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `placement_positions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_applications` ADD CONSTRAINT `placement_applications_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_applications` ADD CONSTRAINT `placement_applications_resume_id_fkey` FOREIGN KEY (`resume_id`) REFERENCES `placement_resumes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_rounds` ADD CONSTRAINT `placement_rounds_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_rounds` ADD CONSTRAINT `placement_rounds_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_round_results` ADD CONSTRAINT `placement_round_results_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_round_results` ADD CONSTRAINT `placement_round_results_round_id_fkey` FOREIGN KEY (`round_id`) REFERENCES `placement_rounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_round_results` ADD CONSTRAINT `placement_round_results_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `placement_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_selections` ADD CONSTRAINT `placement_selections_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_selections` ADD CONSTRAINT `placement_selections_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_selections` ADD CONSTRAINT `placement_selections_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `placement_positions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_selections` ADD CONSTRAINT `placement_selections_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `placement_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_selections` ADD CONSTRAINT `placement_selections_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `placement_positions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `placement_applications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_selection_id_fkey` FOREIGN KEY (`selection_id`) REFERENCES `placement_selections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_offers` ADD CONSTRAINT `placement_offers_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_joinings` ADD CONSTRAINT `placement_joinings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_joinings` ADD CONSTRAINT `placement_joinings_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_joinings` ADD CONSTRAINT `placement_joinings_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `placement_offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_academic_year_id_fkey` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_drive_id_fkey` FOREIGN KEY (`drive_id`) REFERENCES `placement_drives`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `placement_positions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `placement_outcomes` ADD CONSTRAINT `placement_outcomes_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `placement_offers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_sequences` ADD CONSTRAINT `inventory_sequences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_categories` ADD CONSTRAINT `inventory_categories_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_categories` ADD CONSTRAINT `inventory_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `inventory_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_vendors` ADD CONSTRAINT `inventory_vendors_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_products` ADD CONSTRAINT `inventory_products_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_products` ADD CONSTRAINT `inventory_products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_locations` ADD CONSTRAINT `inventory_locations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_locations` ADD CONSTRAINT `inventory_locations_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_locations` ADD CONSTRAINT `inventory_locations_building_id_fkey` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_locations` ADD CONSTRAINT `inventory_locations_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_items` ADD CONSTRAINT `inventory_stock_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_items` ADD CONSTRAINT `inventory_stock_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_items` ADD CONSTRAINT `inventory_stock_items_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_movements` ADD CONSTRAINT `inventory_stock_movements_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_movements` ADD CONSTRAINT `inventory_stock_movements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_movements` ADD CONSTRAINT `inventory_stock_movements_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_requests` ADD CONSTRAINT `inventory_purchase_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_requests` ADD CONSTRAINT `inventory_purchase_requests_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_requests` ADD CONSTRAINT `inventory_purchase_requests_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_request_items` ADD CONSTRAINT `inventory_purchase_request_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_request_items` ADD CONSTRAINT `inventory_purchase_request_items_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `inventory_purchase_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_request_items` ADD CONSTRAINT `inventory_purchase_request_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_orders` ADD CONSTRAINT `inventory_purchase_orders_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_orders` ADD CONSTRAINT `inventory_purchase_orders_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_orders` ADD CONSTRAINT `inventory_purchase_orders_purchase_request_id_fkey` FOREIGN KEY (`purchase_request_id`) REFERENCES `inventory_purchase_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_order_items` ADD CONSTRAINT `inventory_purchase_order_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_order_items` ADD CONSTRAINT `inventory_purchase_order_items_po_id_fkey` FOREIGN KEY (`po_id`) REFERENCES `inventory_purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_purchase_order_items` ADD CONSTRAINT `inventory_purchase_order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipts` ADD CONSTRAINT `inventory_goods_receipts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipts` ADD CONSTRAINT `inventory_goods_receipts_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipts` ADD CONSTRAINT `inventory_goods_receipts_po_id_fkey` FOREIGN KEY (`po_id`) REFERENCES `inventory_purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipt_items` ADD CONSTRAINT `inventory_goods_receipt_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipt_items` ADD CONSTRAINT `inventory_goods_receipt_items_grn_id_fkey` FOREIGN KEY (`grn_id`) REFERENCES `inventory_goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipt_items` ADD CONSTRAINT `inventory_goods_receipt_items_po_item_id_fkey` FOREIGN KEY (`po_item_id`) REFERENCES `inventory_purchase_order_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipt_items` ADD CONSTRAINT `inventory_goods_receipt_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_goods_receipt_items` ADD CONSTRAINT `inventory_goods_receipt_items_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfers` ADD CONSTRAINT `inventory_stock_transfers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfers` ADD CONSTRAINT `inventory_stock_transfers_from_location_id_fkey` FOREIGN KEY (`from_location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfers` ADD CONSTRAINT `inventory_stock_transfers_to_location_id_fkey` FOREIGN KEY (`to_location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfer_items` ADD CONSTRAINT `inventory_stock_transfer_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfer_items` ADD CONSTRAINT `inventory_stock_transfer_items_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `inventory_stock_transfers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_transfer_items` ADD CONSTRAINT `inventory_stock_transfer_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_adjustments` ADD CONSTRAINT `inventory_stock_adjustments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_adjustments` ADD CONSTRAINT `inventory_stock_adjustments_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_adjustment_items` ADD CONSTRAINT `inventory_stock_adjustment_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_adjustment_items` ADD CONSTRAINT `inventory_stock_adjustment_items_adjustment_id_fkey` FOREIGN KEY (`adjustment_id`) REFERENCES `inventory_stock_adjustments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_stock_adjustment_items` ADD CONSTRAINT `inventory_stock_adjustment_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `inventory_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_assets` ADD CONSTRAINT `inventory_assets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_assets` ADD CONSTRAINT `inventory_assets_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_assets` ADD CONSTRAINT `inventory_assets_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_assets` ADD CONSTRAINT `inventory_assets_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `inventory_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_assignments` ADD CONSTRAINT `inventory_asset_assignments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_assignments` ADD CONSTRAINT `inventory_asset_assignments_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `inventory_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_assignments` ADD CONSTRAINT `inventory_asset_assignments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_assignments` ADD CONSTRAINT `inventory_asset_assignments_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_assignments` ADD CONSTRAINT `inventory_asset_assignments_campus_id_fkey` FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_maintenance` ADD CONSTRAINT `inventory_asset_maintenance_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_maintenance` ADD CONSTRAINT `inventory_asset_maintenance_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `inventory_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_maintenance` ADD CONSTRAINT `inventory_asset_maintenance_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_warranty_claims` ADD CONSTRAINT `inventory_asset_warranty_claims_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_warranty_claims` ADD CONSTRAINT `inventory_asset_warranty_claims_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `inventory_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_depreciation_entries` ADD CONSTRAINT `inventory_asset_depreciation_entries_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_depreciation_entries` ADD CONSTRAINT `inventory_asset_depreciation_entries_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `inventory_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_disposals` ADD CONSTRAINT `inventory_asset_disposals_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_asset_disposals` ADD CONSTRAINT `inventory_asset_disposals_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `inventory_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_sequences` ADD CONSTRAINT `helpdesk_sequences_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_departments` ADD CONSTRAINT `helpdesk_departments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_categories` ADD CONSTRAINT `helpdesk_categories_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_categories` ADD CONSTRAINT `helpdesk_categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `helpdesk_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_categories` ADD CONSTRAINT `helpdesk_categories_default_department_id_fkey` FOREIGN KEY (`default_department_id`) REFERENCES `helpdesk_departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_categories` ADD CONSTRAINT `helpdesk_categories_sla_policy_id_fkey` FOREIGN KEY (`sla_policy_id`) REFERENCES `helpdesk_sla_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_sla_policies` ADD CONSTRAINT `helpdesk_sla_policies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_sla_policies` ADD CONSTRAINT `helpdesk_sla_policies_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `helpdesk_departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_tickets` ADD CONSTRAINT `helpdesk_tickets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_tickets` ADD CONSTRAINT `helpdesk_tickets_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `helpdesk_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_tickets` ADD CONSTRAINT `helpdesk_tickets_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `helpdesk_departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_tickets` ADD CONSTRAINT `helpdesk_tickets_sla_policy_id_fkey` FOREIGN KEY (`sla_policy_id`) REFERENCES `helpdesk_sla_policies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_comments` ADD CONSTRAINT `helpdesk_ticket_comments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_comments` ADD CONSTRAINT `helpdesk_ticket_comments_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_attachments` ADD CONSTRAINT `helpdesk_ticket_attachments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_attachments` ADD CONSTRAINT `helpdesk_ticket_attachments_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_attachments` ADD CONSTRAINT `helpdesk_ticket_attachments_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `helpdesk_ticket_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_history` ADD CONSTRAINT `helpdesk_ticket_history_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_ticket_history` ADD CONSTRAINT `helpdesk_ticket_history_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_escalations` ADD CONSTRAINT `helpdesk_escalations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_escalations` ADD CONSTRAINT `helpdesk_escalations_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_feedback` ADD CONSTRAINT `helpdesk_feedback_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `helpdesk_feedback` ADD CONSTRAINT `helpdesk_feedback_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_reports` ADD CONSTRAINT `saved_reports_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_reports` ADD CONSTRAINT `saved_reports_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_templates` ADD CONSTRAINT `report_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_templates` ADD CONSTRAINT `report_templates_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_schedules` ADD CONSTRAINT `report_schedules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_schedules` ADD CONSTRAINT `report_schedules_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `report_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_schedules` ADD CONSTRAINT `report_schedules_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_saved_report_id_fkey` FOREIGN KEY (`saved_report_id`) REFERENCES `saved_reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `report_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `report_schedules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `analytics_snapshots` ADD CONSTRAINT `analytics_snapshots_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_query_logs` ADD CONSTRAINT `ai_query_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_query_logs` ADD CONSTRAINT `ai_query_logs_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_query_logs` ADD CONSTRAINT `ai_query_logs_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_query_logs` ADD CONSTRAINT `ai_query_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_feedback` ADD CONSTRAINT `ai_feedback_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_feedback` ADD CONSTRAINT `ai_feedback_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_feedback` ADD CONSTRAINT `ai_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_document_classifications` ADD CONSTRAINT `ai_document_classifications_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_document_classifications` ADD CONSTRAINT `ai_document_classifications_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_document_classifications` ADD CONSTRAINT `ai_document_classifications_document_version_id_fkey` FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_document_classifications` ADD CONSTRAINT `ai_document_classifications_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integrations` ADD CONSTRAINT `integrations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_webhook_endpoints` ADD CONSTRAINT `integration_webhook_endpoints_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_webhook_endpoints` ADD CONSTRAINT `integration_webhook_endpoints_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_webhook_events` ADD CONSTRAINT `integration_webhook_events_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_webhook_events` ADD CONSTRAINT `integration_webhook_events_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_webhook_events` ADD CONSTRAINT `integration_webhook_events_webhook_endpoint_id_fkey` FOREIGN KEY (`webhook_endpoint_id`) REFERENCES `integration_webhook_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_operations` ADD CONSTRAINT `integration_operations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_operations` ADD CONSTRAINT `integration_operations_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_sync_runs` ADD CONSTRAINT `integration_sync_runs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_sync_runs` ADD CONSTRAINT `integration_sync_runs_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_sync_records` ADD CONSTRAINT `integration_sync_records_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_sync_records` ADD CONSTRAINT `integration_sync_records_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_sync_records` ADD CONSTRAINT `integration_sync_records_sync_run_id_fkey` FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_failures` ADD CONSTRAINT `integration_failures_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_failures` ADD CONSTRAINT `integration_failures_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_failures` ADD CONSTRAINT `integration_failures_operation_id_fkey` FOREIGN KEY (`operation_id`) REFERENCES `integration_operations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_failures` ADD CONSTRAINT `integration_failures_webhook_event_id_fkey` FOREIGN KEY (`webhook_event_id`) REFERENCES `integration_webhook_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_failures` ADD CONSTRAINT `integration_failures_sync_run_id_fkey` FOREIGN KEY (`sync_run_id`) REFERENCES `integration_sync_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_job_rows` ADD CONSTRAINT `import_job_rows_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_job_rows` ADD CONSTRAINT `import_job_rows_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_templates` ADD CONSTRAINT `import_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `search_histories` ADD CONSTRAINT `search_histories_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `search_histories` ADD CONSTRAINT `search_histories_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `background_jobs` ADD CONSTRAINT `background_jobs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_documents` ADD CONSTRAINT `generated_documents_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_providers` ADD CONSTRAINT `identity_providers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_providers` ADD CONSTRAINT `identity_providers_default_role_id_fkey` FOREIGN KEY (`default_role_id`) REFERENCES `roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_identities` ADD CONSTRAINT `external_identities_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_identities` ADD CONSTRAINT `external_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `external_identities` ADD CONSTRAINT `external_identities_identity_provider_id_fkey` FOREIGN KEY (`identity_provider_id`) REFERENCES `identity_providers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_provider_role_mappings` ADD CONSTRAINT `identity_provider_role_mappings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_provider_role_mappings` ADD CONSTRAINT `identity_provider_role_mappings_identity_provider_id_fkey` FOREIGN KEY (`identity_provider_id`) REFERENCES `identity_providers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `identity_provider_role_mappings` ADD CONSTRAINT `identity_provider_role_mappings_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_sessions` ADD CONSTRAINT `onboarding_sessions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
