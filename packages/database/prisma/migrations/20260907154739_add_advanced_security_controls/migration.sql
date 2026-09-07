-- AlterEnum
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SUSPICIOUS_LOGIN_BLOCKED';

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('MFA_ENABLED', 'MFA_DISABLED', 'MFA_CHALLENGE_SUCCEEDED', 'MFA_CHALLENGE_FAILED', 'BACKUP_CODE_USED', 'BACKUP_CODES_REGENERATED', 'NEW_DEVICE_LOGIN', 'SUSPICIOUS_LOGIN_FLAGGED', 'SUSPICIOUS_LOGIN_BLOCKED', 'TRUSTED_DEVICE_ADDED', 'TRUSTED_DEVICE_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_REUSE_BLOCKED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'SESSION_REVOKED', 'ALL_SESSIONS_REVOKED');

-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_secret_encrypted" TEXT,
ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_secret_encrypted" TEXT,
ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mfa_backup_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_mfa_backup_codes" (
    "id" TEXT NOT NULL,
    "platform_user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_token_hash" TEXT NOT NULL,
    "label" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "AuditScope" NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" TEXT,
    "event_type" "SecurityEventType" NOT NULL,
    "severity" "SecurityEventSeverity" NOT NULL DEFAULT 'INFO',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_security_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "mfa_required" BOOLEAN NOT NULL DEFAULT false,
    "password_history_count" INTEGER,
    "max_failed_login_attempts" INTEGER,
    "account_lockout_minutes" INTEGER,
    "trusted_device_days" INTEGER,
    "notify_on_new_device_login" BOOLEAN NOT NULL DEFAULT true,
    "block_suspicious_logins" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_security_settings" (
    "id" TEXT NOT NULL,
    "mfa_globally_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mfa_required_for_platform_admins" BOOLEAN NOT NULL DEFAULT false,
    "default_max_failed_login_attempts" INTEGER NOT NULL DEFAULT 5,
    "default_account_lockout_minutes" INTEGER NOT NULL DEFAULT 15,
    "default_password_history_count" INTEGER NOT NULL DEFAULT 5,
    "default_trusted_device_days" INTEGER NOT NULL DEFAULT 30,
    "suspicious_login_detection_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_backup_codes_code_hash_key" ON "mfa_backup_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_backup_codes_tenant_id_idx" ON "mfa_backup_codes"("tenant_id");

-- CreateIndex
CREATE INDEX "mfa_backup_codes_user_id_idx" ON "mfa_backup_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_mfa_backup_codes_code_hash_key" ON "platform_mfa_backup_codes"("code_hash");

-- CreateIndex
CREATE INDEX "platform_mfa_backup_codes_platform_user_id_idx" ON "platform_mfa_backup_codes"("platform_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_device_token_hash_key" ON "trusted_devices"("device_token_hash");

-- CreateIndex
CREATE INDEX "trusted_devices_tenant_id_user_id_idx" ON "trusted_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "password_history_tenant_id_idx" ON "password_history"("tenant_id");

-- CreateIndex
CREATE INDEX "password_history_user_id_created_at_idx" ON "password_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_tenant_id_created_at_idx" ON "security_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_user_id_created_at_idx" ON "security_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_platform_user_id_created_at_idx" ON "security_events"("platform_user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_event_type_created_at_idx" ON "security_events"("event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_settings_tenant_id_key" ON "tenant_security_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_mfa_backup_codes" ADD CONSTRAINT "platform_mfa_backup_codes_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_security_settings" ADD CONSTRAINT "tenant_security_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
