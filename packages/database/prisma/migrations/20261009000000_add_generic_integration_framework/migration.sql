-- Generic, vendor-neutral integration framework.
--
-- Additive only — seven new tables and no existing row or query changes.
--
--   integrations                    — a tenant's configured connection to one external system (the root).
--   integration_webhook_endpoints    — a public URL an external system POSTs to, with its own signing secret.
--   integration_webhook_events      — durable record of every inbound delivery (the event log).
--   integration_operations          — one outbound call, reused across retries (the operation log).
--   integration_sync_runs           — one synchronization run with denormalized counters.
--   integration_sync_records        — per-entity sync state (the idempotency ledger / change detection).
--   integration_failures            — the failure log: one immutable row per failed attempt of any kind.
--
-- Why category and provider are separate columns: `category` answers "what is this system"
-- (PAYMENT_GATEWAY, ACCOUNTING, LMS, …) and `provider` answers "which adapter speaks to it"
-- (http_json, webhook, mock, or a runtime-registered key). Keeping vendors out of the enum is
-- what stops this framework from coupling the ERP to one external system — onboarding a new
-- vendor is a config row, not a migration.
--
-- On delete behaviour:
--   * Tenant is ON DELETE RESTRICT, matching every other tenant-owned table in this schema: a
--     tenant is never deleted out from under its integration history.
--   * Child tables cascade off Integration: the connection is gone, so its endpoints, operations,
--     sync state and failure log have no meaning without it.
--   * IntegrationWebhookEvent.integrationId is SET NULL rather than cascade, so a delivery that
--     arrived and failed to process survives an operator deleting the connection mid-incident —
--     that row is the evidence.
--   * IntegrationSyncRecord.syncRunId is SET NULL: records are a standing ledger keyed by
--     (integration, entityType, externalId), not owned by one run. Deleting a run must not erase
--     the ledger that makes the *next* run idempotent.
--   * IntegrationFailure's three optional parents are all SET NULL: the failure is the immutable
--     fact an operator triages, and it must outlive whichever work record produced it.
--
-- Every table carries a REQUIRED tenant_id so packages/database's DMMF-derived tenant-guard
-- extension auto-scopes it with no further registration.

-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM (
    'PAYMENT_GATEWAY',
    'ACCOUNTING',
    'LMS',
    'BIOMETRIC',
    'RFID',
    'IDENTITY_PROVIDER',
    'DOCUMENT_SERVICE',
    'SMS',
    'WHATSAPP',
    'EMAIL'
);

-- CreateEnum
CREATE TYPE "IntegrationDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY');

-- CreateEnum
CREATE TYPE "IntegrationOperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "IntegrationSyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY');

-- CreateEnum
CREATE TYPE "IntegrationSyncRecordStatus" AS ENUM ('IN_SYNC', 'PENDING', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IntegrationFailureCategory" AS ENUM (
    'AUTHENTICATION',
    'CONFIGURATION',
    'NETWORK',
    'TIMEOUT',
    'RATE_LIMIT',
    'PROVIDER_REJECTED',
    'SIGNATURE',
    'SCHEMA',
    'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "WebhookSignatureAlgorithm" AS ENUM (
    'HMAC_SHA256',
    'HMAC_SHA256_TS',
    'HMAC_SHA256_PREFIXED',
    'BEARER_TOKEN'
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "direction" "IntegrationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "description" TEXT,
    "config" JSONB,
    "credentials_encrypted" TEXT,
    "retry_policy" JSONB,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DRAFT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "health_status" "IntegrationHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_tested_at" TIMESTAMP(3),
    "last_test_succeeded_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error_message" TEXT,
    "last_latency_ms" INTEGER,
    "sync_cursor" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "path_token" TEXT NOT NULL,
    "event_types" TEXT[],
    "secret_encrypted" TEXT NOT NULL,
    "signature_header" TEXT NOT NULL DEFAULT 'x-integration-signature',
    "signature_algorithm" "WebhookSignatureAlgorithm" NOT NULL DEFAULT 'HMAC_SHA256',
    "signature_tolerance_secs" INTEGER NOT NULL DEFAULT 300,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_event_at" TIMESTAMP(3),
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_events" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID,
    "webhook_endpoint_id" UUID NOT NULL,
    "external_event_id" TEXT,
    "event_type" TEXT NOT NULL,
    "status" "IntegrationWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "headers" JSONB,
    "response_status" INTEGER,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "integration_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_operations" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "IntegrationOperationStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "idempotency_key" TEXT,
    "request" JSONB,
    "response" JSONB,
    "error_message" TEXT,
    "failure_category" "IntegrationFailureCategory",
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "next_retry_at" TIMESTAMP(3),
    "latency_ms" INTEGER,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "status" "IntegrationSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "IntegrationSyncTrigger" NOT NULL DEFAULT 'MANUAL',
    "scope" JSONB,
    "cursor_before" TEXT,
    "cursor_after" TEXT,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "has_more" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_records" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "sync_run_id" UUID,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_id" TEXT,
    "content_hash" TEXT,
    "status" "IntegrationSyncRecordStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    -- Last-known provider payload, stored redacted. Only a CHANGED record rewrites it (see the
    -- change-detection hash in packages/integrations/sync.ts), so this is a reconciliation aid and a
    -- push source rather than a full cache of the provider's dataset.
    "payload" JSONB,
    "error_message" TEXT,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_failures" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID,
    "operation_id" UUID,
    "webhook_event_id" UUID,
    "sync_run_id" UUID,
    "category" "IntegrationFailureCategory" NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "provider_code" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The tenant-unique stable handle used in URLs and job payloads (never the display name).
CREATE UNIQUE INDEX "integrations_tenant_id_key_key" ON "integrations"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "integrations_tenant_id_category_status_idx" ON "integrations"("tenant_id", "category", "status");

-- CreateIndex
CREATE INDEX "integrations_tenant_id_status_is_default_idx" ON "integrations"("tenant_id", "status", "is_default");

-- CreateIndex
CREATE INDEX "integrations_tenant_id_health_status_idx" ON "integrations"("tenant_id", "health_status");

-- CreateIndex
-- Unique platform-wide, not per tenant: path_token is the whole public identity of an endpoint, so
-- two tenants must not be able to collide on it. It is also the rotation handle — changing it
-- revokes a leaked webhook URL without touching the integration.
CREATE UNIQUE INDEX "integration_webhook_endpoints_path_token_key" ON "integration_webhook_endpoints"("path_token");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_endpoints_integration_id_name_key" ON "integration_webhook_endpoints"("integration_id", "name");

-- CreateIndex
CREATE INDEX "integration_webhook_endpoints_tenant_id_is_active_idx" ON "integration_webhook_endpoints"("tenant_id", "is_active");

-- CreateIndex
-- The replay guard: a provider re-delivering the same external_event_id to the same endpoint is
-- rejected as a duplicate rather than double-processing (e.g. charging twice). Nullable
-- external_event_id means providers that send no id are simply not deduped — Postgres treats
-- NULLs as distinct, so many such rows coexist.
CREATE UNIQUE INDEX "integration_webhook_events_webhook_endpoint_id_external_event_id_key" ON "integration_webhook_events"("webhook_endpoint_id", "external_event_id");

-- CreateIndex
CREATE INDEX "integration_webhook_events_tenant_id_status_received_at_idx" ON "integration_webhook_events"("tenant_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "integration_webhook_events_tenant_id_event_type_received_at_idx" ON "integration_webhook_events"("tenant_id", "event_type", "received_at");

-- CreateIndex
CREATE INDEX "integration_webhook_events_tenant_id_integration_id_idx" ON "integration_webhook_events"("tenant_id", "integration_id");

-- CreateIndex
-- The idempotency ledger for outbound calls: one row per (integration, idempotency key) so a
-- retry after an ambiguous timeout cannot double-charge a card or double-create a vendor invoice.
CREATE UNIQUE INDEX "integration_operations_integration_id_idempotency_key_key" ON "integration_operations"("integration_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "integration_operations_tenant_id_status_created_at_idx" ON "integration_operations"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "integration_operations_tenant_id_integration_id_operation_idx" ON "integration_operations"("tenant_id", "integration_id", "operation");

-- CreateIndex
CREATE INDEX "integration_operations_status_next_retry_at_idx" ON "integration_operations"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_tenant_id_status_created_at_idx" ON "integration_sync_runs"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_tenant_id_integration_id_created_at_idx" ON "integration_sync_runs"("tenant_id", "integration_id", "created_at");

-- CreateIndex
-- One ledger row per synced entity. This unique index is what makes a re-run idempotent: a
-- second sync upserts onto the same row instead of duplicating the entity.
CREATE UNIQUE INDEX "integration_sync_records_integration_id_entity_type_external_id_key" ON "integration_sync_records"("integration_id", "entity_type", "external_id");

-- CreateIndex
CREATE INDEX "integration_sync_records_tenant_id_status_idx" ON "integration_sync_records"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "integration_sync_records_tenant_id_integration_id_entity_type_idx" ON "integration_sync_records"("tenant_id", "integration_id", "entity_type");

-- CreateIndex
CREATE INDEX "integration_sync_records_sync_run_id_idx" ON "integration_sync_records"("sync_run_id");

-- CreateIndex
CREATE INDEX "integration_failures_tenant_id_created_at_idx" ON "integration_failures"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_failures_tenant_id_category_resolved_at_idx" ON "integration_failures"("tenant_id", "category", "resolved_at");

-- CreateIndex
CREATE INDEX "integration_failures_tenant_id_integration_id_created_at_idx" ON "integration_failures"("tenant_id", "integration_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_failures_resolved_at_idx" ON "integration_failures"("resolved_at");

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_endpoints" ADD CONSTRAINT "integration_webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_endpoints" ADD CONSTRAINT "integration_webhook_endpoints_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, not cascade: a delivery that arrived and failed to process is the evidence an
-- operator needs, and must survive the connection being deleted mid-incident.
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "integration_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_operations" ADD CONSTRAINT "integration_operations_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "integration_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_failures" ADD CONSTRAINT "integration_failures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_failures" ADD CONSTRAINT "integration_failures_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_failures" ADD CONSTRAINT "integration_failures_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "integration_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_failures" ADD CONSTRAINT "integration_failures_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "integration_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_failures" ADD CONSTRAINT "integration_failures_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "integration_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
