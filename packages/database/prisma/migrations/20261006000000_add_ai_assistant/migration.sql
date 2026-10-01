-- AI ERP Assistant: conversation/query/feedback persistence plus document classification results.
--
-- Additive only — nothing existing changes. Four tables:
--   ai_conversations / ai_messages / ai_query_logs / ai_feedback  — the assistant's own history.
--   ai_document_classifications                                   — AI/OCR output per document version.
--
-- On delete behaviour:
--   * Tenant cascade mirrors every other tenant-owned table, so deleting a tenant removes its AI
--     history with it (the compliance story stays simple: no orphaned prompts outlive the tenant).
--   * Conversation cascade is deliberate: messages and query logs ARE the conversation, and an
--     owner deleting their thread should not leave fragments behind.
--   * AiQueryLog.conversationId is ON DELETE SET NULL, not cascade: the query log is the audit
--     record and must survive its conversation being deleted.
--   * AiDocumentClassification cascades off Document/DocumentVersion: the file is gone, so the
--     classification of it is meaningless and its extracted text must not linger in the database.
--
-- Every table carries a REQUIRED tenant_id so packages/database's DMMF-derived tenant-guard
-- extension (TENANT_SCOPED_MODELS) auto-scopes it with no further registration.

-- CreateEnum
CREATE TYPE "AiIntent" AS ENUM (
    'LOW_ATTENDANCE_STUDENTS',
    'OUTSTANDING_FEES',
    'ADMISSIONS_STATISTICS',
    'DEPARTMENT_PERFORMANCE',
    'EXAM_PERFORMANCE',
    'PLACEMENT_STATISTICS',
    'ANALYTICS_OVERVIEW',
    'REPORT_GENERATION',
    'COMMUNICATION_DRAFT',
    'STUDENT_RISK_INSIGHTS'
);

-- CreateEnum
CREATE TYPE "AiResponseKind" AS ENUM ('DATA', 'DATA_WITH_NARRATION', 'GENERATED_TEXT', 'UNSUPPORTED', 'FORBIDDEN', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDocumentClassificationStatus" AS ENUM ('PENDING', 'CLASSIFIED', 'NO_TEXT', 'ERROR', 'CONFIRMED', 'CORRECTED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "intent" "AiIntent",
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "filters" JSONB,
    "scope_snapshot" JSONB,
    "response_kind" "AiResponseKind" NOT NULL DEFAULT 'DATA',
    "provider" TEXT,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_query_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "user_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "intent" "AiIntent",
    "outcome" "AiResponseKind" NOT NULL DEFAULT 'DATA',
    "scope_snapshot" JSONB,
    "filters" JSONB,
    "source_permission" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_document_classifications" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "suggested_category" TEXT,
    "suggested_type_id" UUID,
    "confidence" DOUBLE PRECISION,
    "extracted_text" TEXT,
    "extracted_fields" JSONB,
    "status" "AiDocumentClassificationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmed_type_id" UUID,
    "confirmed_category" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_document_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_owner_id_updated_at_idx" ON "ai_conversations"("tenant_id", "owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_idx" ON "ai_conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_messages_tenant_id_conversation_id_created_at_idx" ON "ai_messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_messages_tenant_id_created_at_idx" ON "ai_messages"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_query_logs_tenant_id_created_at_idx" ON "ai_query_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_query_logs_tenant_id_user_id_created_at_idx" ON "ai_query_logs"("tenant_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_query_logs_tenant_id_intent_created_at_idx" ON "ai_query_logs"("tenant_id", "intent", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_query_logs_tenant_id_outcome_idx" ON "ai_query_logs"("tenant_id", "outcome");

-- One audit row per assistant answer. Nullable so a question that failed before producing an answer
-- can still be logged; Postgres treats NULLs as distinct, so many such rows are fine.
CREATE UNIQUE INDEX "ai_query_logs_message_id_key" ON "ai_query_logs"("message_id");

-- CreateIndex
CREATE INDEX "ai_feedback_tenant_id_created_at_idx" ON "ai_feedback"("tenant_id", "created_at" DESC);

-- One classification per version (the worker re-runs are updates in place, not new rows).
CREATE UNIQUE INDEX "ai_document_classifications_tenant_id_document_version_id_key" ON "ai_document_classifications"("tenant_id", "document_version_id");

-- CreateIndex
CREATE INDEX "ai_document_classifications_tenant_id_status_created_at_idx" ON "ai_document_classifications"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_document_classifications_tenant_id_document_id_idx" ON "ai_document_classifications"("tenant_id", "document_id");

-- The review queue reads "unreviewed, oldest first" and the per-document history reads by document.
CREATE INDEX "ai_document_classifications_tenant_id_status_reviewed_at_idx" ON "ai_document_classifications"("tenant_id", "status", "reviewed_at");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_query_logs" ADD CONSTRAINT "ai_query_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_query_logs" ADD CONSTRAINT "ai_query_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_query_logs" ADD CONSTRAINT "ai_query_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_query_logs" ADD CONSTRAINT "ai_query_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_classifications" ADD CONSTRAINT "ai_document_classifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_classifications" ADD CONSTRAINT "ai_document_classifications_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_classifications" ADD CONSTRAINT "ai_document_classifications_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_document_classifications" ADD CONSTRAINT "ai_document_classifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;