/**
 * Inventory & Asset Management DTOs. Follows the library/exams convention:
 * class-validator + Swagger, stringly-typed enum values validated with IsIn against
 * exported constants (mirroring the Prisma enums over the wire).
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// ── Closed taxonomies (mirrors of the Prisma enums) ─────────────────────────

export const INVENTORY_CATEGORY_KINDS = ['PRODUCT', 'ASSET'] as const;
export const INVENTORY_VENDOR_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const INVENTORY_LOCATION_TYPES = ['WAREHOUSE', 'STORE', 'LAB', 'ROOM', 'OTHER'] as const;
export const INVENTORY_STOCK_MOVEMENT_TYPES = ['INITIAL', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUBTRACT'] as const;
export const INVENTORY_PURCHASE_REQUEST_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;
export const INVENTORY_PURCHASE_ORDER_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export const INVENTORY_GOODS_RECEIPT_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;
export const INVENTORY_STOCK_TRANSFER_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
export const INVENTORY_STOCK_ADJUSTMENT_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;
export const INVENTORY_ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'UNDER_MAINTENANCE', 'DECOMMISSIONED', 'DISPOSED', 'WRITTEN_OFF'] as const;
export const INVENTORY_ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'DISPOSED'] as const;
export const INVENTORY_DEPRECIATION_METHODS = ['NONE', 'STRAIGHT_LINE'] as const;
export const INVENTORY_ASSIGNMENT_TYPES = ['EMPLOYEE', 'DEPARTMENT', 'CAMPUS', 'OTHER'] as const;
export const INVENTORY_ASSIGNMENT_STATUSES = ['ACTIVE', 'RETURNED'] as const;
export const INVENTORY_MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'OTHER'] as const;
export const INVENTORY_MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const INVENTORY_WARRANTY_CLAIM_STATUSES = ['OPEN', 'APPROVED', 'REPAIRED', 'REJECTED', 'CLOSED'] as const;
export const INVENTORY_DISPOSAL_TYPES = ['SALE', 'SCRAP', 'DONATION', 'RETURN_TO_VENDOR'] as const;
export const INVENTORY_DISPOSAL_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class InventoryPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

export class ListStockItemsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean;
}

export class ListStockMovementsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn(INVENTORY_STOCK_MOVEMENT_TYPES)
  type?: string;
}

export class ListInventoryDocsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsString()
  status?: string;
}

// ── Vendors ─────────────────────────────────────────────────────────────────

export class CreateInventoryVendorDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsIn(INVENTORY_VENDOR_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInventoryVendorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsIn(INVENTORY_VENDOR_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Categories ──────────────────────────────────────────────────────────────

export class ListInventoryCategoriesDto {
  @IsOptional()
  @IsIn(INVENTORY_CATEGORY_KINDS)
  kind?: string;
}

export class CreateInventoryCategoryDto {
  @IsIn(INVENTORY_CATEGORY_KINDS)
  kind: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class UpdateInventoryCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

// ── Products ────────────────────────────────────────────────────────────────

export class ListProductsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInventoryProductDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInventoryProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

// ── Locations ───────────────────────────────────────────────────────────────

export class CreateInventoryLocationDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(INVENTORY_LOCATION_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInventoryLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(INVENTORY_LOCATION_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Purchase requests ───────────────────────────────────────────────────────

export class InventoryRequestItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantityRequested: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInventoryPurchaseRequestDto {
  @IsOptional()
  @IsString()
  requestedBy?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsDateString()
  requestedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @IsNotEmpty()
  @Type(() => InventoryRequestItemDto)
  items: InventoryRequestItemDto[];
}

export class UpdateInventoryPurchaseRequestDto {
  @IsOptional()
  @IsString()
  requestedBy?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @Type(() => InventoryRequestItemDto)
  items?: InventoryRequestItemDto[];
}

export class RejectInventoryPurchaseRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Purchase orders ─────────────────────────────────────────────────────────

export class InventoryOrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantityOrdered: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInventoryPurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @IsNotEmpty()
  @Type(() => InventoryOrderItemDto)
  items: InventoryOrderItemDto[];
}

export class UpdateInventoryPurchaseOrderDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @Type(() => InventoryOrderItemDto)
  items?: InventoryOrderItemDto[];
}

// ── Goods receipts ──────────────────────────────────────────────────────────

export class InventoryGoodsReceiptItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsInt()
  @Min(1)
  quantityReceived: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsString()
  poItemId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInventoryGoodsReceiptDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsOptional()
  @IsString()
  poId?: string;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @IsNotEmpty()
  @Type(() => InventoryGoodsReceiptItemDto)
  items: InventoryGoodsReceiptItemDto[];
}

// ── Stock transfers ─────────────────────────────────────────────────────────

export class InventoryTransferItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateInventoryStockTransferDto {
  @IsString()
  @IsNotEmpty()
  fromLocationId: string;

  @IsString()
  @IsNotEmpty()
  toLocationId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @IsNotEmpty()
  @Type(() => InventoryTransferItemDto)
  items: InventoryTransferItemDto[];
}

// ── Stock adjustments ───────────────────────────────────────────────────────

export class InventoryAdjustmentItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  quantityDelta: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateInventoryStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsNotEmpty()
  @Type(() => InventoryAdjustmentItemDto)
  items: InventoryAdjustmentItemDto[];
}

// ── Assets ──────────────────────────────────────────────────────────────────

export class ListAssetsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(INVENTORY_ASSET_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  assignedOnly?: boolean;
}

export class CreateInventoryAssetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsOptional()
  @IsString()
  assetCode?: string;

  @IsOptional()
  @IsString()
  tagNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  purchaseCostCents?: number;

  @IsOptional()
  @IsDateString()
  warrantyStartDate?: string;

  @IsOptional()
  @IsDateString()
  warrantyEndDate?: string;

  @IsOptional()
  @IsString()
  warrantyProvider?: string;

  @IsOptional()
  @IsIn(INVENTORY_ASSET_CONDITIONS)
  condition?: string;

  @IsOptional()
  @IsIn(INVENTORY_DEPRECIATION_METHODS)
  depreciationMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salvageValueCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInventoryAssetDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  assetCode?: string;

  @IsOptional()
  @IsString()
  tagNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  purchaseCostCents?: number;

  @IsOptional()
  @IsDateString()
  warrantyStartDate?: string;

  @IsOptional()
  @IsDateString()
  warrantyEndDate?: string;

  @IsOptional()
  @IsString()
  warrantyProvider?: string;

  @IsOptional()
  @IsIn(INVENTORY_ASSET_CONDITIONS)
  condition?: string;

  @IsOptional()
  @IsIn(INVENTORY_DEPRECIATION_METHODS)
  depreciationMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salvageValueCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignAssetDto {
  @IsIn(INVENTORY_ASSIGNMENT_TYPES)
  assigneeType: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  assigneeName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReturnAssetDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export class ListMaintenanceDto extends InventoryPaginationDto {
  @IsOptional()
  @IsIn(INVENTORY_MAINTENANCE_STATUSES)
  status?: string;
}

export class CreateInventoryMaintenanceDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsIn(INVENTORY_MAINTENANCE_TYPES)
  type?: string;

  @IsOptional()
  @IsIn(INVENTORY_MAINTENANCE_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  performedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInventoryMaintenanceDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsIn(INVENTORY_MAINTENANCE_TYPES)
  type?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  performedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetInventoryMaintenanceStatusDto {
  @IsIn(INVENTORY_MAINTENANCE_STATUSES)
  status: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

// ── Warranty claims ─────────────────────────────────────────────────────────

export class ListWarrantyClaimsDto extends InventoryPaginationDto {
  @IsOptional()
  @IsIn(INVENTORY_WARRANTY_CLAIM_STATUSES)
  status?: string;
}

export class CreateWarrantyClaimDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateWarrantyClaimDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetWarrantyClaimStatusDto {
  @IsIn(INVENTORY_WARRANTY_CLAIM_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}

// ── Disposals ───────────────────────────────────────────────────────────────

export class CreateDisposalDto {
  @IsIn(INVENTORY_DISPOSAL_TYPES)
  type: string;

  @IsOptional()
  @IsDateString()
  disposalDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  proceedsCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CompleteDisposalDto {
  @IsOptional()
  @IsDateString()
  disposalDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  proceedsCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Depreciation ────────────────────────────────────────────────────────────

export class RunDepreciationDto {
  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class InventoryReportQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  days?: number;
}