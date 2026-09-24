-- CreateEnum
CREATE TYPE "HelpdeskTicketStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HelpdeskTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HelpdeskTicketSource" AS ENUM ('WEB', 'EMAIL', 'PHONE', 'WALK_IN', 'API', 'OTHER');

-- CreateEnum
CREATE TYPE "HelpdeskCommentVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "HelpdeskHistoryEvent" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'PRIORITY_CHANGED', 'DEPARTMENT_CHANGED', 'CATEGORY_CHANGED', 'COMMENTED', 'ATTACHED', 'ESCALATED', 'RESOLVED', 'REOPENED', 'CLOSED', 'FEEDBACK_SUBMITTED', 'SLA_BREACHED');

-- CreateEnum
CREATE TYPE "HelpdeskEscalationReason" AS ENUM ('RESPONSE_BREACH', 'RESOLUTION_BREACH', 'MANUAL');

-- CreateEnum
CREATE TYPE "HelpdeskSequenceKind" AS ENUM ('TICKET');

-- CreateTable
CREATE TABLE "helpdesk_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "HelpdeskSequenceKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "email" TEXT,
    "campus_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_sla_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" "HelpdeskTicketPriority",
    "department_id" UUID,
    "response_minutes" INTEGER NOT NULL DEFAULT 240,
    "resolution_minutes" INTEGER NOT NULL DEFAULT 1440,
    "at_risk_minutes" INTEGER,
    "escalate_to_role_code" TEXT,
    "escalate_after_minutes" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "default_priority" "HelpdeskTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "default_department_id" UUID,
    "sla_policy_id" UUID,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sequence_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "HelpdeskTicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "HelpdeskTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "source" "HelpdeskTicketSource" NOT NULL DEFAULT 'WEB',
    "category_id" UUID NOT NULL,
    "department_id" UUID,
    "sla_policy_id" UUID,
    "requester_user_id" UUID,
    "requester_name" TEXT,
    "requester_email" TEXT,
    "assigned_to_user_id" UUID,
    "response_due_at" TIMESTAMP(3),
    "resolution_due_at" TIMESTAMP(3),
    "first_responded_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "reopened_count" INTEGER NOT NULL DEFAULT 0,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMP(3),
    "resolution_summary" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "satisfaction_score" INTEGER,
    "satisfaction_comment" TEXT,
    "satisfaction_submitted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_ticket_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID,
    "visibility" "HelpdeskCommentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "body" TEXT NOT NULL,
    "is_resolution_note" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpdesk_ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_ticket_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "comment_id" UUID,
    "document_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_ticket_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "event" "HelpdeskHistoryEvent" NOT NULL,
    "actor_user_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "from_value" TEXT,
    "to_value" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_ticket_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_escalations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "reason" "HelpdeskEscalationReason" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "from_assignee_user_id" UUID,
    "to_user_id" UUID,
    "to_role_code" TEXT,
    "note" TEXT,
    "escalated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "submitted_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "helpdesk_sequences_tenant_id_idx" ON "helpdesk_sequences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_sequences_tenant_id_kind_key" ON "helpdesk_sequences"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "helpdesk_departments_tenant_id_idx" ON "helpdesk_departments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_departments_tenant_id_code_key" ON "helpdesk_departments"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "helpdesk_sla_policies_tenant_id_idx" ON "helpdesk_sla_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_sla_policies_tenant_id_priority_idx" ON "helpdesk_sla_policies"("tenant_id", "priority");

-- CreateIndex
CREATE INDEX "helpdesk_sla_policies_tenant_id_department_id_idx" ON "helpdesk_sla_policies"("tenant_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_sla_policies_tenant_id_code_key" ON "helpdesk_sla_policies"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "helpdesk_categories_tenant_id_idx" ON "helpdesk_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_categories_tenant_id_parent_id_idx" ON "helpdesk_categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_categories_tenant_id_code_key" ON "helpdesk_categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_idx" ON "helpdesk_tickets"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_status_idx" ON "helpdesk_tickets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_priority_idx" ON "helpdesk_tickets"("tenant_id", "priority");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_assigned_to_user_id_idx" ON "helpdesk_tickets"("tenant_id", "assigned_to_user_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_department_id_idx" ON "helpdesk_tickets"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_category_id_idx" ON "helpdesk_tickets"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "helpdesk_tickets_tenant_id_resolution_due_at_idx" ON "helpdesk_tickets"("tenant_id", "resolution_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_tickets_tenant_id_ticket_number_key" ON "helpdesk_tickets"("tenant_id", "ticket_number");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_comments_tenant_id_idx" ON "helpdesk_ticket_comments"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_comments_tenant_id_ticket_id_idx" ON "helpdesk_ticket_comments"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_attachments_tenant_id_idx" ON "helpdesk_ticket_attachments"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_attachments_tenant_id_ticket_id_idx" ON "helpdesk_ticket_attachments"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_history_tenant_id_idx" ON "helpdesk_ticket_history"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_ticket_history_tenant_id_ticket_id_idx" ON "helpdesk_ticket_history"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "helpdesk_escalations_tenant_id_idx" ON "helpdesk_escalations"("tenant_id");

-- CreateIndex
CREATE INDEX "helpdesk_escalations_tenant_id_ticket_id_idx" ON "helpdesk_escalations"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "helpdesk_feedback_tenant_id_idx" ON "helpdesk_feedback"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_feedback_tenant_id_ticket_id_key" ON "helpdesk_feedback"("tenant_id", "ticket_id");

-- AddForeignKey
ALTER TABLE "helpdesk_sequences" ADD CONSTRAINT "helpdesk_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_departments" ADD CONSTRAINT "helpdesk_departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_sla_policies" ADD CONSTRAINT "helpdesk_sla_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_sla_policies" ADD CONSTRAINT "helpdesk_sla_policies_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "helpdesk_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "helpdesk_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_default_department_id_fkey" FOREIGN KEY ("default_department_id") REFERENCES "helpdesk_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "helpdesk_sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "helpdesk_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "helpdesk_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "helpdesk_sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_comments" ADD CONSTRAINT "helpdesk_ticket_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_comments" ADD CONSTRAINT "helpdesk_ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_attachments" ADD CONSTRAINT "helpdesk_ticket_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_attachments" ADD CONSTRAINT "helpdesk_ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_attachments" ADD CONSTRAINT "helpdesk_ticket_attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "helpdesk_ticket_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_history" ADD CONSTRAINT "helpdesk_ticket_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_ticket_history" ADD CONSTRAINT "helpdesk_ticket_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_escalations" ADD CONSTRAINT "helpdesk_escalations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_escalations" ADD CONSTRAINT "helpdesk_escalations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_feedback" ADD CONSTRAINT "helpdesk_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_feedback" ADD CONSTRAINT "helpdesk_feedback_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "helpdesk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
