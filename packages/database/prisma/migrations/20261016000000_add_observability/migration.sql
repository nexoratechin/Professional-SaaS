-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('FIRING', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'FIRING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "metric_name" TEXT,
    "metric_value" DECIMAL(18,4),
    "threshold" DECIMAL(18,4),
    "details" JSONB,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_platform_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_error_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "route" TEXT,
    "method" TEXT,
    "request_id" TEXT,
    "tenant_id" UUID,
    "user_id" TEXT,
    "context" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "system_error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_alerts_status_severity_last_seen_at_idx" ON "system_alerts"("status", "severity", "last_seen_at");

-- CreateIndex
CREATE INDEX "system_alerts_rule_key_dedupe_key_status_idx" ON "system_alerts"("rule_key", "dedupe_key", "status");

-- CreateIndex
CREATE INDEX "system_alerts_fired_at_idx" ON "system_alerts"("fired_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_error_events_fingerprint_key" ON "system_error_events"("fingerprint");

-- CreateIndex
CREATE INDEX "system_error_events_source_last_seen_at_idx" ON "system_error_events"("source", "last_seen_at");

-- CreateIndex
CREATE INDEX "system_error_events_last_seen_at_idx" ON "system_error_events"("last_seen_at");

