-- CreateEnum
CREATE TYPE "EntitlementType" AS ENUM ('BOOLEAN', 'QUANTITY');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('PLAN', 'PLAN_MODULE', 'TENANT_OVERRIDE', 'SUBSCRIPTION_ITEM');

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum
ALTER TYPE "SubscriptionItemType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "subscription_items" ADD COLUMN     "module_key" TEXT;

-- CreateTable
CREATE TABLE "plan_modules" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EntitlementType" NOT NULL DEFAULT 'BOOLEAN',
    "limit_value" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" "EntitlementType" NOT NULL DEFAULT 'BOOLEAN',
    "bool_value" BOOLEAN NOT NULL DEFAULT false,
    "limit_value" INTEGER,
    "source" "EntitlementSource" NOT NULL,
    "source_ref" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_until" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_modules_plan_id_module_key_key" ON "plan_modules"("plan_id", "module_key");

-- CreateIndex
CREATE INDEX "entitlements_tenant_id_idx" ON "entitlements"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_tenant_id_key_key" ON "entitlements"("tenant_id", "key");

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
