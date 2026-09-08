-- CreateEnum
CREATE TYPE "WorkflowStateCategory" AS ENUM ('INITIAL', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowTransitionAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RESUBMIT', 'ESCALATE', 'CANCEL');

-- CreateEnum
CREATE TYPE "WorkflowApprovalMode" AS ENUM ('NONE', 'SEQUENTIAL', 'PARALLEL');

-- CreateEnum
CREATE TYPE "WorkflowParallelRule" AS ENUM ('ALL', 'ANY', 'QUORUM');

-- CreateEnum
CREATE TYPE "WorkflowApproverType" AS ENUM ('ROLE', 'SPECIFIC_USER');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'EXPIRED', 'SKIPPED');

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "WorkflowStateCategory" NOT NULL DEFAULT 'IN_PROGRESS',
    "allows_resubmission" BOOLEAN NOT NULL DEFAULT false,
    "sequence_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "from_state_id" UUID NOT NULL,
    "to_state_id" UUID NOT NULL,
    "action" "WorkflowTransitionAction" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition_expression" JSONB,
    "approval_mode" "WorkflowApprovalMode" NOT NULL DEFAULT 'NONE',
    "parallel_rule" "WorkflowParallelRule",
    "parallel_quorum_count" INTEGER,
    "deadline_hours" INTEGER,
    "escalation_role_code" TEXT,
    "escalation_after_hours" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transition_approvers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transition_id" UUID NOT NULL,
    "approver_type" "WorkflowApproverType" NOT NULL,
    "role_code" TEXT,
    "specific_user_id" UUID,
    "scope_field" TEXT,
    "sequence_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transition_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "current_state_id" UUID NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "context" JSONB,
    "started_by" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_approval_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "transition_id" UUID NOT NULL,
    "approver_slot_id" UUID,
    "assigned_user_id" UUID,
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'PENDING',
    "sequence_order" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "escalated_at" TIMESTAMP(3),
    "escalated_to_role_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_tenant_id_idx" ON "workflow_definitions"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_definitions_tenant_id_entity_type_is_active_idx" ON "workflow_definitions"("tenant_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_tenant_id_code_key" ON "workflow_definitions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "workflow_states_tenant_id_idx" ON "workflow_states"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_states_definition_id_code_key" ON "workflow_states"("definition_id", "code");

-- CreateIndex
CREATE INDEX "workflow_transitions_tenant_id_idx" ON "workflow_transitions"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_transitions_from_state_id_idx" ON "workflow_transitions"("from_state_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_definition_id_code_key" ON "workflow_transitions"("definition_id", "code");

-- CreateIndex
CREATE INDEX "workflow_transition_approvers_tenant_id_idx" ON "workflow_transition_approvers"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_transition_approvers_transition_id_idx" ON "workflow_transition_approvers"("transition_id");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_id_idx" ON "workflow_instances"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_id_status_idx" ON "workflow_instances"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_definition_id_idx" ON "workflow_instances"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_tenant_id_entity_type_entity_id_key" ON "workflow_instances"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "workflow_approval_tasks_tenant_id_idx" ON "workflow_approval_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "workflow_approval_tasks_instance_id_idx" ON "workflow_approval_tasks"("instance_id");

-- CreateIndex
CREATE INDEX "workflow_approval_tasks_status_due_at_idx" ON "workflow_approval_tasks"("status", "due_at");

-- CreateIndex
CREATE INDEX "workflow_approval_tasks_assigned_user_id_status_idx" ON "workflow_approval_tasks"("assigned_user_id", "status");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_from_state_id_fkey" FOREIGN KEY ("from_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_to_state_id_fkey" FOREIGN KEY ("to_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition_approvers" ADD CONSTRAINT "workflow_transition_approvers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition_approvers" ADD CONSTRAINT "workflow_transition_approvers_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_current_state_id_fkey" FOREIGN KEY ("current_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_tasks" ADD CONSTRAINT "workflow_approval_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_tasks" ADD CONSTRAINT "workflow_approval_tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_tasks" ADD CONSTRAINT "workflow_approval_tasks_transition_id_fkey" FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_tasks" ADD CONSTRAINT "workflow_approval_tasks_approver_slot_id_fkey" FOREIGN KEY ("approver_slot_id") REFERENCES "workflow_transition_approvers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
