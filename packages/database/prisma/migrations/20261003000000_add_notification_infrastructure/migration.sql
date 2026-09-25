-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'PUSH';

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "last_attempt_at" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3),
ADD COLUMN     "template_id" UUID,
ADD COLUMN     "variables" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "subject_template" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "variables" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template_id" UUID NOT NULL,
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audience_filter" JSONB NOT NULL,
    "audience_count" INTEGER,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "channel" "NotificationChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "provider_message_id" TEXT,
    "request" JSONB,
    "response" JSONB,
    "error" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_provider_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT,
    "config" JSONB,
    "credentials_encrypted" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event_triggers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_event_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_push_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_templates_tenant_id_channel_idx" ON "notification_templates"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "notification_templates_tenant_id_is_active_idx" ON "notification_templates"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "notification_templates_tenant_id_deleted_at_idx" ON "notification_templates"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenant_id_code_key" ON "notification_templates"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "notification_campaigns_tenant_id_status_idx" ON "notification_campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "notification_campaigns_tenant_id_template_id_idx" ON "notification_campaigns"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "notification_campaigns_tenant_id_deleted_at_idx" ON "notification_campaigns"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_tenant_id_notification_id_idx" ON "notification_delivery_logs"("tenant_id", "notification_id");

-- CreateIndex
CREATE INDEX "notification_delivery_logs_tenant_id_status_idx" ON "notification_delivery_logs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "notification_provider_configs_tenant_id_channel_is_active_idx" ON "notification_provider_configs"("tenant_id", "channel", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_provider_configs_tenant_id_channel_provider_key" ON "notification_provider_configs"("tenant_id", "channel", "provider");

-- CreateIndex
CREATE INDEX "notification_event_triggers_tenant_id_event_key_idx" ON "notification_event_triggers"("tenant_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_triggers_tenant_id_event_key_template_id_key" ON "notification_event_triggers"("tenant_id", "event_key", "template_id");

-- CreateIndex
CREATE INDEX "notification_preferences_tenant_id_user_id_idx" ON "notification_preferences"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_user_id_channel_key" ON "notification_preferences"("tenant_id", "user_id", "channel");

-- CreateIndex
CREATE INDEX "user_push_devices_tenant_id_user_id_idx" ON "user_push_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_push_devices_tenant_id_user_id_device_token_key" ON "user_push_devices"("tenant_id", "user_id", "device_token");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_channel_idx" ON "notifications"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_campaign_id_idx" ON "notifications"("tenant_id", "campaign_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "notification_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_campaigns" ADD CONSTRAINT "notification_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_campaigns" ADD CONSTRAINT "notification_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery_logs" ADD CONSTRAINT "notification_delivery_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery_logs" ADD CONSTRAINT "notification_delivery_logs_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_provider_configs" ADD CONSTRAINT "notification_provider_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event_triggers" ADD CONSTRAINT "notification_event_triggers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event_triggers" ADD CONSTRAINT "notification_event_triggers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_devices" ADD CONSTRAINT "user_push_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_push_devices" ADD CONSTRAINT "user_push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;