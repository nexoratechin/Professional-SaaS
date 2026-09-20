-- AddFeesFinance
-- Complete Fees & Finance surface (Phase 14) built on top of the Student 360 fee ledger.
-- Adds the catalog/planning/workflow layers (FeeHead, FeeStructure(+lines), StudentFeeAssignment,
-- FeeDemand, FeeConcession, FeeRefund, FeeSequence) and extends StudentFee with structure/line/
-- demand provenance + installment + late-fee accumulators. Money is integer minor units
-- (paise/cents) everywhere. Existing StudentFee/StudentPayment rows are untouched (all new
-- StudentFee columns are nullable/defaulted).

-- Enums -------------------------------------------------------------------------------------
CREATE TYPE "FeeHeadFrequency" AS ENUM ('ONE_TIME', 'PER_TERM', 'ANNUAL');
CREATE TYPE "FeeStructureStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "FeeAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REVOKED');
CREATE TYPE "FeeConcessionKind" AS ENUM ('SCHOLARSHIP', 'CONCESSION', 'WAIVER');
CREATE TYPE "FeeConcessionBasis" AS ENUM ('FLAT', 'PERCENT');
CREATE TYPE "FeeConcessionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');
CREATE TYPE "FeeRefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED');
CREATE TYPE "FeeSequenceKind" AS ENUM ('RECEIPT', 'DEMAND', 'REFUND');

-- Fee catalog ---------------------------------------------------------------------------------
CREATE TABLE "fee_heads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "frequency" "FeeHeadFrequency" NOT NULL,
  "default_amount_cents" INTEGER NOT NULL,
  "is_optional" BOOLEAN NOT NULL DEFAULT false,
  "is_refundable" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_heads_tenant_id_code_key" ON "fee_heads" ("tenant_id", "code");
CREATE INDEX "fee_heads_tenant_id_idx" ON "fee_heads" ("tenant_id");
CREATE INDEX "fee_heads_tenant_id_is_active_idx" ON "fee_heads" ("tenant_id", "is_active");
CREATE INDEX "fee_heads_tenant_id_deleted_at_idx" ON "fee_heads" ("tenant_id", "deleted_at");

-- Fee structures ------------------------------------------------------------------------------
CREATE TABLE "fee_structures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "FeeStructureStatus" NOT NULL DEFAULT 'DRAFT',
  "academic_year_id" UUID,
  "term_id" UUID,
  "program_id" UUID,
  "section_id" UUID,
  "installment_count" INTEGER NOT NULL DEFAULT 1,
  "due_day_offset" INTEGER NOT NULL DEFAULT 30,
  "installment_gap_days" INTEGER NOT NULL DEFAULT 0,
  "late_fee_percent_bps" INTEGER NOT NULL DEFAULT 0,
  "late_fee_flat_cents" INTEGER NOT NULL DEFAULT 0,
  "late_fee_grace_days" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_structures_tenant_id_idx" ON "fee_structures" ("tenant_id");
CREATE INDEX "fee_structures_tenant_id_status_idx" ON "fee_structures" ("tenant_id", "status");
CREATE INDEX "fee_structures_tenant_id_academic_year_id_idx" ON "fee_structures" ("tenant_id", "academic_year_id");
CREATE INDEX "fee_structures_tenant_id_deleted_at_idx" ON "fee_structures" ("tenant_id", "deleted_at");

CREATE TABLE "fee_structure_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "head_id" UUID NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fee_structure_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_structure_lines_structure_id_head_id_key" ON "fee_structure_lines" ("structure_id", "head_id");
CREATE INDEX "fee_structure_lines_tenant_id_idx" ON "fee_structure_lines" ("tenant_id");
CREATE INDEX "fee_structure_lines_tenant_id_structure_id_idx" ON "fee_structure_lines" ("tenant_id", "structure_id");
CREATE INDEX "fee_structure_lines_tenant_id_head_id_idx" ON "fee_structure_lines" ("tenant_id", "head_id");

-- Student <-> structure assignments -------------------------------------------------------------
CREATE TABLE "student_fee_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "structure_id" UUID NOT NULL,
  "term_id" UUID,
  "status" "FeeAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "effective_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "assigned_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "student_fee_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_fee_assignments_tenant_id_student_id_structure_id_term_id_key" ON "student_fee_assignments" ("tenant_id", "student_id", "structure_id", "term_id");
CREATE INDEX "student_fee_assignments_tenant_id_idx" ON "student_fee_assignments" ("tenant_id");
CREATE INDEX "student_fee_assignments_tenant_id_student_id_idx" ON "student_fee_assignments" ("tenant_id", "student_id");
CREATE INDEX "student_fee_assignments_tenant_id_structure_id_idx" ON "student_fee_assignments" ("tenant_id", "structure_id");
CREATE INDEX "student_fee_assignments_tenant_id_status_idx" ON "student_fee_assignments" ("tenant_id", "status");
CREATE INDEX "student_fee_assignments_tenant_id_term_id_idx" ON "student_fee_assignments" ("tenant_id", "term_id");

-- Demands (one per installment) -----------------------------------------------------------------
CREATE TABLE "fee_demands" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "assignment_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "term_id" UUID,
  "demand_number" TEXT NOT NULL,
  "installment_index" INTEGER NOT NULL DEFAULT 1,
  "issue_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "status" "FeeStatus" NOT NULL DEFAULT 'ISSUED',
  "total_cents" INTEGER NOT NULL,
  "paid_cents" INTEGER NOT NULL DEFAULT 0,
  "waived_cents" INTEGER NOT NULL DEFAULT 0,
  "late_fee_cents" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fee_demands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_demands_tenant_id_demand_number_key" ON "fee_demands" ("tenant_id", "demand_number");
CREATE INDEX "fee_demands_tenant_id_idx" ON "fee_demands" ("tenant_id");
CREATE INDEX "fee_demands_tenant_id_student_id_idx" ON "fee_demands" ("tenant_id", "student_id");
CREATE INDEX "fee_demands_tenant_id_assignment_id_idx" ON "fee_demands" ("tenant_id", "assignment_id");
CREATE INDEX "fee_demands_tenant_id_status_idx" ON "fee_demands" ("tenant_id", "status");
CREATE INDEX "fee_demands_tenant_id_due_date_idx" ON "fee_demands" ("tenant_id", "due_date");

-- Concessions (scholarship / waiver / concession) ------------------------------------------------
CREATE TABLE "fee_concessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "demand_id" UUID,
  "student_fee_id" UUID,
  "head_id" UUID,
  "kind" "FeeConcessionKind" NOT NULL,
  "basis" "FeeConcessionBasis" NOT NULL,
  "percent_bps" INTEGER,
  "amount_cents" INTEGER,
  "applied_cents" INTEGER NOT NULL DEFAULT 0,
  "distribution" JSONB,
  "reason" TEXT NOT NULL,
  "status" "FeeConcessionStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by" TEXT,
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "remarks" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fee_concessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_concessions_tenant_id_idx" ON "fee_concessions" ("tenant_id");
CREATE INDEX "fee_concessions_tenant_id_student_id_idx" ON "fee_concessions" ("tenant_id", "student_id");
CREATE INDEX "fee_concessions_tenant_id_status_idx" ON "fee_concessions" ("tenant_id", "status");
CREATE INDEX "fee_concessions_tenant_id_demand_id_idx" ON "fee_concessions" ("tenant_id", "demand_id");
CREATE INDEX "fee_concessions_tenant_id_student_fee_id_idx" ON "fee_concessions" ("tenant_id", "student_fee_id");

-- Refunds ------------------------------------------------------------------------------------------
CREATE TABLE "fee_refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "refund_number" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "FeeRefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by" TEXT,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "processed_by" TEXT,
  "processed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "reference_number" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fee_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_refunds_tenant_id_refund_number_key" ON "fee_refunds" ("tenant_id", "refund_number");
CREATE INDEX "fee_refunds_tenant_id_idx" ON "fee_refunds" ("tenant_id");
CREATE INDEX "fee_refunds_tenant_id_student_id_idx" ON "fee_refunds" ("tenant_id", "student_id");
CREATE INDEX "fee_refunds_tenant_id_payment_id_idx" ON "fee_refunds" ("tenant_id", "payment_id");
CREATE INDEX "fee_refunds_tenant_id_status_idx" ON "fee_refunds" ("tenant_id", "status");

-- Numbering counters -------------------------------------------------------------------------------
CREATE TABLE "fee_sequences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "kind" "FeeSequenceKind" NOT NULL,
  "prefix" TEXT NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fee_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fee_sequences_tenant_id_kind_prefix_key" ON "fee_sequences" ("tenant_id", "kind", "prefix");
CREATE INDEX "fee_sequences_tenant_id_idx" ON "fee_sequences" ("tenant_id");

-- Extend the existing Student 360 fee ledger ---------------------------------------------------------
ALTER TABLE "student_fees"
  ADD COLUMN "structure_id" UUID,
  ADD COLUMN "structure_line_id" UUID,
  ADD COLUMN "demand_id" UUID,
  ADD COLUMN "installment_index" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "late_fee_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_late_fee_accrued_at" TIMESTAMP(3);

CREATE INDEX "student_fees_tenant_id_demand_id_idx" ON "student_fees" ("tenant_id", "demand_id");
CREATE INDEX "student_fees_tenant_id_structure_id_idx" ON "student_fees" ("tenant_id", "structure_id");

ALTER TABLE "student_payments"
  ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "student_payments_tenant_id_idempotency_key_key" ON "student_payments" ("tenant_id", "idempotency_key");

CREATE TABLE "student_fee_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "student_fee_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_fee_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_fee_allocations_payment_id_student_fee_id_key" ON "student_fee_allocations" ("payment_id", "student_fee_id");
CREATE INDEX "student_fee_allocations_tenant_id_idx" ON "student_fee_allocations" ("tenant_id");
CREATE INDEX "student_fee_allocations_tenant_id_student_fee_id_idx" ON "student_fee_allocations" ("tenant_id", "student_fee_id");
CREATE INDEX "student_fee_allocations_tenant_id_payment_id_idx" ON "student_fee_allocations" ("tenant_id", "payment_id");

-- Foreign keys -----------------------------------------------------------------------------------------
ALTER TABLE "fee_heads" ADD CONSTRAINT "fee_heads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "fee_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "student_fee_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "fee_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_student_fee_id_fkey" FOREIGN KEY ("student_fee_id") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_concessions" ADD CONSTRAINT "fee_concessions_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "fee_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "student_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_sequences" ADD CONSTRAINT "fee_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "fee_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_structure_line_id_fkey" FOREIGN KEY ("structure_line_id") REFERENCES "fee_structure_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "fee_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_fee_allocations" ADD CONSTRAINT "student_fee_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_fee_allocations" ADD CONSTRAINT "student_fee_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "student_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_fee_allocations" ADD CONSTRAINT "student_fee_allocations_student_fee_id_fkey" FOREIGN KEY ("student_fee_id") REFERENCES "student_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;