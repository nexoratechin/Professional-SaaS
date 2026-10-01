-- Advanced analytics dashboards (SaaS control plane + per-college): a materialized rollup table
-- the worker refreshes out-of-band, plus the composite indexes the aggregate queries read through.
--
-- The new indexes are deliberately narrow: each one exists because a specific analytics rollup
-- filters on exactly those columns, so a dashboard refresh is an index scan rather than a seq scan
-- over the transactional ledgers (payments, attendance, results, invoices) it summarizes. Nothing
-- here changes existing behavior - these are additive only.

-- CreateEnum
CREATE TYPE "AnalyticsSnapshotScope" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "AnalyticsGranularity" AS ENUM ('DAILY', 'MONTHLY');

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "scope" "AnalyticsSnapshotScope" NOT NULL DEFAULT 'TENANT',
    "scope_key" TEXT NOT NULL,
    "tenant_id" UUID,
    "granularity" "AnalyticsGranularity" NOT NULL DEFAULT 'DAILY',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_scope_scope_key_granularity_period_start_key" ON "analytics_snapshots"("scope", "scope_key", "granularity", "period_start");

-- CreateIndex
CREATE INDEX "analytics_snapshots_scope_key_period_start_idx" ON "analytics_snapshots"("scope_key", "period_start" DESC);

-- CreateIndex
CREATE INDEX "analytics_snapshots_tenant_id_period_start_idx" ON "analytics_snapshots"("tenant_id", "period_start" DESC);

-- CreateIndex
CREATE INDEX "tenants_created_at_idx" ON "tenants"("created_at");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_start_idx" ON "subscriptions"("current_period_start");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "subscription_items_tenant_id_item_type_idx" ON "subscription_items"("tenant_id", "item_type");

-- CreateIndex
CREATE INDEX "usage_events_occurred_at_idx" ON "usage_events"("occurred_at");

-- CreateIndex
CREATE INDEX "invoices_period_start_idx" ON "invoices"("period_start");

-- CreateIndex
CREATE INDEX "invoices_status_period_start_idx" ON "invoices"("status", "period_start");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "users_last_login_at_idx" ON "users"("last_login_at");

-- CreateIndex
CREATE INDEX "students_tenant_id_created_at_idx" ON "students"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "students_tenant_id_campus_id_status_idx" ON "students"("tenant_id", "campus_id", "status");

-- CreateIndex
CREATE INDEX "student_attendance_tenant_id_date_idx" ON "student_attendance"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "student_attendance_tenant_id_date_status_idx" ON "student_attendance"("tenant_id", "date", "status");

-- CreateIndex
CREATE INDEX "student_fees_tenant_id_due_date_status_idx" ON "student_fees"("tenant_id", "due_date", "status");

-- CreateIndex
CREATE INDEX "student_payments_tenant_id_payment_date_idx" ON "student_payments"("tenant_id", "payment_date");

-- CreateIndex
CREATE INDEX "student_payments_tenant_id_payment_date_status_idx" ON "student_payments"("tenant_id", "payment_date", "status");

-- CreateIndex
CREATE INDEX "student_results_tenant_id_outcome_idx" ON "student_results"("tenant_id", "outcome");

-- CreateIndex
CREATE INDEX "student_results_tenant_id_published_at_idx" ON "student_results"("tenant_id", "published_at");

-- CreateIndex
CREATE INDEX "admission_applications_tenant_id_created_at_idx" ON "admission_applications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "faculty_workloads_tenant_id_is_active_idx" ON "faculty_workloads"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "placement_outcomes_tenant_id_academic_year_id_outcome_status_idx" ON "placement_outcomes"("tenant_id", "academic_year_id", "outcome_status");

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
