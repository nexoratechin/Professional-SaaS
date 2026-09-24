-- CreateEnum
CREATE TYPE "InventorySequenceKind" AS ENUM ('VENDOR', 'CATEGORY', 'PRODUCT', 'LOCATION', 'PURCHASE_REQUEST', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'ASSET', 'ASSET_TAG', 'MAINTENANCE', 'WARRANTY_CLAIM', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "InventoryCategoryKind" AS ENUM ('PRODUCT', 'ASSET');

-- CreateEnum
CREATE TYPE "InventoryVendorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InventoryLocationType" AS ENUM ('WAREHOUSE', 'STORE', 'LAB', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryStockMovementType" AS ENUM ('INITIAL', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUBTRACT');

-- CreateEnum
CREATE TYPE "InventoryPurchaseRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryPurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryGoodsReceiptStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryStockTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryStockAdjustmentStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryAssetStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'UNDER_MAINTENANCE', 'DECOMMISSIONED', 'DISPOSED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "InventoryAssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "InventoryDepreciationMethod" AS ENUM ('NONE', 'STRAIGHT_LINE');

-- CreateEnum
CREATE TYPE "InventoryAssignmentType" AS ENUM ('EMPLOYEE', 'DEPARTMENT', 'CAMPUS', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryAssignmentStatus" AS ENUM ('ACTIVE', 'RETURNED');

-- CreateEnum
CREATE TYPE "InventoryMaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryMaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryWarrantyClaimStatus" AS ENUM ('OPEN', 'APPROVED', 'REPAIRED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InventoryDisposalType" AS ENUM ('SALE', 'SCRAP', 'DONATION', 'RETURN_TO_VENDOR');

-- CreateEnum
CREATE TYPE "InventoryDisposalStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "inventory_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "InventorySequenceKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "InventoryCategoryKind" NOT NULL DEFAULT 'PRODUCT',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_vendors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT DEFAULT 'India',
    "website" TEXT,
    "payment_terms" TEXT,
    "status" "InventoryVendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "unit_price_cents" INTEGER,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InventoryLocationType" NOT NULL DEFAULT 'STORE',
    "campus_id" UUID,
    "building_id" UUID,
    "room_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "last_movement_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "type" "InventoryStockMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "notes" TEXT,
    "posted_by" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_purchase_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "status" "InventoryPurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "department_id" UUID,
    "vendor_id" UUID,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "reviewed_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_purchase_request_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_requested" INTEGER NOT NULL,
    "quantity_approved" INTEGER,
    "unit_price_cents" INTEGER,
    "notes" TEXT,

    CONSTRAINT "inventory_purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "vendor_id" UUID NOT NULL,
    "status" "InventoryPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "purchase_request_id" UUID,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMP(3),
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "inventory_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "grn_number" TEXT NOT NULL,
    "vendor_id" UUID NOT NULL,
    "po_id" UUID,
    "status" "InventoryGoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_goods_receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "grn_id" UUID NOT NULL,
    "po_item_id" UUID,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity_received" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "status" "InventoryStockTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_transfer_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "adjustment_number" TEXT NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "InventoryStockAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "description" TEXT,
    "adjusted_by" TEXT,
    "adjusted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_stock_adjustment_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_code" TEXT NOT NULL,
    "tag_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID NOT NULL,
    "vendor_id" UUID,
    "location_id" UUID,
    "serial_number" TEXT,
    "brand" TEXT,
    "model_name" TEXT,
    "purchase_date" DATE,
    "purchase_cost_cents" INTEGER,
    "warranty_start_date" DATE,
    "warranty_end_date" DATE,
    "warranty_provider" TEXT,
    "status" "InventoryAssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "InventoryAssetCondition" NOT NULL DEFAULT 'NEW',
    "depreciation_method" "InventoryDepreciationMethod" NOT NULL DEFAULT 'NONE',
    "useful_life_months" INTEGER,
    "salvage_value_cents" INTEGER NOT NULL DEFAULT 0,
    "current_book_value_cents" INTEGER,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_asset_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "assignee_type" "InventoryAssignmentType" NOT NULL,
    "employee_id" UUID,
    "department_id" UUID,
    "campus_id" UUID,
    "assignee_name" TEXT,
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMP(3),
    "status" "InventoryAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_asset_maintenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "maintenance_number" TEXT NOT NULL,
    "vendor_id" UUID,
    "type" "InventoryMaintenanceType" NOT NULL DEFAULT 'PREVENTIVE',
    "status" "InventoryMaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_date" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "description" TEXT,
    "cost_cents" INTEGER,
    "performed_by" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_asset_warranty_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "claim_number" TEXT NOT NULL,
    "status" "InventoryWarrantyClaimStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "resolution" TEXT,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_asset_warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_asset_depreciation_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "method" "InventoryDepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "opening_book_value_cents" INTEGER NOT NULL,
    "depreciation_cents" INTEGER NOT NULL,
    "closing_book_value_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_asset_depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_asset_disposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "disposal_number" TEXT NOT NULL,
    "type" "InventoryDisposalType" NOT NULL DEFAULT 'SCRAP',
    "status" "InventoryDisposalStatus" NOT NULL DEFAULT 'DRAFT',
    "disposal_date" DATE,
    "proceeds_cents" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "approved_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_asset_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_sequences_tenant_id_kind_prefix_key" ON "inventory_sequences"("tenant_id", "kind", "prefix");

-- CreateIndex
CREATE INDEX "inventory_categories_tenant_id_idx" ON "inventory_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_categories_tenant_id_deleted_at_idx" ON "inventory_categories"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_tenant_id_kind_code_key" ON "inventory_categories"("tenant_id", "kind", "code");

-- CreateIndex
CREATE INDEX "inventory_vendors_tenant_id_idx" ON "inventory_vendors"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_vendors_tenant_id_deleted_at_idx" ON "inventory_vendors"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_vendors_tenant_id_code_key" ON "inventory_vendors"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "inventory_products_tenant_id_idx" ON "inventory_products"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_products_tenant_id_category_id_idx" ON "inventory_products"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "inventory_products_tenant_id_deleted_at_idx" ON "inventory_products"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_products_tenant_id_code_key" ON "inventory_products"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "inventory_locations_tenant_id_idx" ON "inventory_locations"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_locations_tenant_id_campus_id_idx" ON "inventory_locations"("tenant_id", "campus_id");

-- CreateIndex
CREATE INDEX "inventory_locations_tenant_id_deleted_at_idx" ON "inventory_locations"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_tenant_id_code_key" ON "inventory_locations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "inventory_stock_items_tenant_id_idx" ON "inventory_stock_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_items_tenant_id_product_id_idx" ON "inventory_stock_items"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_stock_items_tenant_id_location_id_idx" ON "inventory_stock_items"("tenant_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_items_tenant_id_location_id_product_id_key" ON "inventory_stock_items"("tenant_id", "location_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_tenant_id_idx" ON "inventory_stock_movements"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_tenant_id_product_id_occurred_at_idx" ON "inventory_stock_movements"("tenant_id", "product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_tenant_id_location_id_occurred_at_idx" ON "inventory_stock_movements"("tenant_id", "location_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_stock_movements_tenant_id_reference_type_referenc_idx" ON "inventory_stock_movements"("tenant_id", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_requests_tenant_id_idx" ON "inventory_purchase_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_requests_tenant_id_status_idx" ON "inventory_purchase_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_purchase_request_items_tenant_id_idx" ON "inventory_purchase_request_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_request_items_request_id_idx" ON "inventory_purchase_request_items"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_purchase_orders_purchase_request_id_key" ON "inventory_purchase_orders"("purchase_request_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_orders_tenant_id_idx" ON "inventory_purchase_orders"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_orders_tenant_id_status_idx" ON "inventory_purchase_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_purchase_order_items_tenant_id_idx" ON "inventory_purchase_order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_purchase_order_items_po_id_idx" ON "inventory_purchase_order_items"("po_id");

-- CreateIndex
CREATE INDEX "inventory_goods_receipts_tenant_id_idx" ON "inventory_goods_receipts"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_goods_receipts_tenant_id_status_idx" ON "inventory_goods_receipts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_goods_receipt_items_tenant_id_idx" ON "inventory_goods_receipt_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_goods_receipt_items_grn_id_idx" ON "inventory_goods_receipt_items"("grn_id");

-- CreateIndex
CREATE INDEX "inventory_stock_transfers_tenant_id_idx" ON "inventory_stock_transfers"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_transfers_tenant_id_status_idx" ON "inventory_stock_transfers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_stock_transfer_items_tenant_id_idx" ON "inventory_stock_transfer_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_transfer_items_transfer_id_idx" ON "inventory_stock_transfer_items"("transfer_id");

-- CreateIndex
CREATE INDEX "inventory_stock_adjustments_tenant_id_idx" ON "inventory_stock_adjustments"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_adjustments_tenant_id_status_idx" ON "inventory_stock_adjustments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_stock_adjustment_items_tenant_id_idx" ON "inventory_stock_adjustment_items"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_stock_adjustment_items_adjustment_id_idx" ON "inventory_stock_adjustment_items"("adjustment_id");

-- CreateIndex
CREATE INDEX "inventory_assets_tenant_id_idx" ON "inventory_assets"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_assets_tenant_id_status_idx" ON "inventory_assets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_assets_tenant_id_category_id_idx" ON "inventory_assets"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "inventory_assets_tenant_id_deleted_at_idx" ON "inventory_assets"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_assets_tenant_id_asset_code_key" ON "inventory_assets"("tenant_id", "asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_assets_tenant_id_tag_number_key" ON "inventory_assets"("tenant_id", "tag_number");

-- CreateIndex
CREATE INDEX "inventory_asset_assignments_tenant_id_idx" ON "inventory_asset_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_asset_assignments_tenant_id_asset_id_idx" ON "inventory_asset_assignments"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "inventory_asset_assignments_tenant_id_status_idx" ON "inventory_asset_assignments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_asset_maintenance_tenant_id_idx" ON "inventory_asset_maintenance"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_asset_maintenance_tenant_id_asset_id_idx" ON "inventory_asset_maintenance"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "inventory_asset_maintenance_tenant_id_status_idx" ON "inventory_asset_maintenance"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "inventory_asset_warranty_claims_tenant_id_idx" ON "inventory_asset_warranty_claims"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_asset_warranty_claims_tenant_id_asset_id_idx" ON "inventory_asset_warranty_claims"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "inventory_asset_depreciation_entries_tenant_id_idx" ON "inventory_asset_depreciation_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_asset_depreciation_entries_tenant_id_asset_id_idx" ON "inventory_asset_depreciation_entries"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_asset_depreciation_entries_tenant_id_asset_id_per_key" ON "inventory_asset_depreciation_entries"("tenant_id", "asset_id", "period_start");

-- CreateIndex
CREATE INDEX "inventory_asset_disposals_tenant_id_idx" ON "inventory_asset_disposals"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_asset_disposals_tenant_id_asset_id_idx" ON "inventory_asset_disposals"("tenant_id", "asset_id");

-- AddForeignKey
ALTER TABLE "inventory_sequences" ADD CONSTRAINT "inventory_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inventory_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_vendors" ADD CONSTRAINT "inventory_vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_products" ADD CONSTRAINT "inventory_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_items" ADD CONSTRAINT "inventory_stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_items" ADD CONSTRAINT "inventory_stock_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_items" ADD CONSTRAINT "inventory_stock_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_requests" ADD CONSTRAINT "inventory_purchase_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_requests" ADD CONSTRAINT "inventory_purchase_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_requests" ADD CONSTRAINT "inventory_purchase_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_request_items" ADD CONSTRAINT "inventory_purchase_request_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_request_items" ADD CONSTRAINT "inventory_purchase_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "inventory_purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_request_items" ADD CONSTRAINT "inventory_purchase_request_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "inventory_purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_order_items" ADD CONSTRAINT "inventory_purchase_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_order_items" ADD CONSTRAINT "inventory_purchase_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "inventory_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_purchase_order_items" ADD CONSTRAINT "inventory_purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipts" ADD CONSTRAINT "inventory_goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipts" ADD CONSTRAINT "inventory_goods_receipts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipts" ADD CONSTRAINT "inventory_goods_receipts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "inventory_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipt_items" ADD CONSTRAINT "inventory_goods_receipt_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipt_items" ADD CONSTRAINT "inventory_goods_receipt_items_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "inventory_goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipt_items" ADD CONSTRAINT "inventory_goods_receipt_items_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "inventory_purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipt_items" ADD CONSTRAINT "inventory_goods_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_goods_receipt_items" ADD CONSTRAINT "inventory_goods_receipt_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfer_items" ADD CONSTRAINT "inventory_stock_transfer_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfer_items" ADD CONSTRAINT "inventory_stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_transfer_items" ADD CONSTRAINT "inventory_stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_adjustments" ADD CONSTRAINT "inventory_stock_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_adjustments" ADD CONSTRAINT "inventory_stock_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_adjustment_items" ADD CONSTRAINT "inventory_stock_adjustment_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_adjustment_items" ADD CONSTRAINT "inventory_stock_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "inventory_stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock_adjustment_items" ADD CONSTRAINT "inventory_stock_adjustment_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_assets" ADD CONSTRAINT "inventory_assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_assignments" ADD CONSTRAINT "inventory_asset_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_assignments" ADD CONSTRAINT "inventory_asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_assignments" ADD CONSTRAINT "inventory_asset_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_assignments" ADD CONSTRAINT "inventory_asset_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_assignments" ADD CONSTRAINT "inventory_asset_assignments_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_maintenance" ADD CONSTRAINT "inventory_asset_maintenance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_maintenance" ADD CONSTRAINT "inventory_asset_maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_maintenance" ADD CONSTRAINT "inventory_asset_maintenance_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_warranty_claims" ADD CONSTRAINT "inventory_asset_warranty_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_warranty_claims" ADD CONSTRAINT "inventory_asset_warranty_claims_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_depreciation_entries" ADD CONSTRAINT "inventory_asset_depreciation_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_depreciation_entries" ADD CONSTRAINT "inventory_asset_depreciation_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_disposals" ADD CONSTRAINT "inventory_asset_disposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_asset_disposals" ADD CONSTRAINT "inventory_asset_disposals_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "inventory_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

