/**
 * Inventory & Asset Management shared types & constants — mirrors the payloads returned by
 * `apps/api/src/modules/inventory`. Inventory is a tenant-wide shared resource (no campus or
 * department scoping on reads), matching the library catalog convention.
 */

export const INVENTORY_VIEW_PERMISSION = 'inventory.view';
export const INVENTORY_CREATE_PERMISSION = 'inventory.create';
export const INVENTORY_UPDATE_PERMISSION = 'inventory.update';
export const INVENTORY_DELETE_PERMISSION = 'inventory.delete';
export const INVENTORY_MANAGE_PERMISSION = 'inventory.manage';

export interface Paged<T> {
  items: T[];
  total: number;
  skip?: number;
  take?: number;
}

export interface LookupOption {
  id: string;
  code: string;
  name: string;
}

export interface LookupsPayload {
  vendors: { id: string; code: string; name: string; gstin?: string | null; paymentTerms?: string | null }[];
  categories: { id: string; kind: string; code: string; name: string; parentId?: string | null }[];
  products: { id: string; code: string; name: string; unit?: string | null; unitPriceCents?: number | null; categoryId: string }[];
  locations: { id: string; code: string; name: string; type: string; campusId?: string | null }[];
  campuses: LookupOption[];
  departments: { id: string; code: string; name: string; campusId?: string | null }[];
  employees: { id: string; employeeCode: string; firstName: string; middleName?: string | null; lastName?: string | null; fullName: string }[];
  categoryKinds: string[];
  vendorStatuses: string[];
  locationTypes: string[];
  stockMovementTypes: string[];
  purchaseRequestStatuses: string[];
  purchaseOrderStatuses: string[];
  goodsReceiptStatuses: string[];
  stockTransferStatuses: string[];
  stockAdjustmentStatuses: string[];
  assetStatuses: string[];
  assetConditions: string[];
  depreciationMethods: string[];
  assignmentTypes: string[];
  maintenanceTypes: string[];
  maintenanceStatuses: string[];
  warrantyClaimStatuses: string[];
  disposalTypes: string[];
  disposalStatuses: string[];
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export interface VendorRow {
  id: string;
  code: string;
  name: string;
  gstin?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status: string;
  paymentTerms?: string | null;
  createdAt: string;
}

export interface CategoryRow {
  id: string;
  kind: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdAt: string;
  _count?: { products: number; assets: number };
}

export interface ProductRow {
  id: string;
  code: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  unitPriceCents?: number | null;
  reorderLevel: number;
  isActive: boolean;
  category: { id: string; code: string; name: string };
  _count?: { stockItems: number };
}

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  notes?: string | null;
  campus?: { id: string; name: string } | null;
  building?: { id: string; name: string } | null;
  room?: { id: string; name: string } | null;
  _count?: { stockItems: number; assets: number };
}

// ── Stock ───────────────────────────────────────────────────────────────────

export interface StockItemRow {
  id: string;
  quantityOnHand: number;
  updatedAt: string;
  product: { id: string; code: string; name: string; unit?: string | null; unitPriceCents?: number | null; reorderLevel: number };
  location: { id: string; code: string; name: string; type: string };
}

export interface StockMovementRow {
  id: string;
  type: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  occurredAt: string;
  product: { id: string; code: string; name: string; unit?: string | null };
  location: { id: string; code: string; name: string };
}

export interface TransferRow {
  id: string;
  transferNumber: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  items: { id: string; quantity: number; product: { id: string; code: string; name: string; unit?: string | null } }[];
}

export interface AdjustmentRow {
  id: string;
  adjustmentNumber: string;
  status: string;
  reason?: string | null;
  description?: string | null;
  createdAt: string;
  location: { id: string; name: string };
  items: { id: string; quantityDelta: number; reason?: string | null; product: { id: string; code: string; name: string; unit?: string | null } }[];
}

// ── Purchasing ──────────────────────────────────────────────────────────────

export interface RequestItem {
  id: string;
  productId: string;
  quantityRequested: number;
  quantityApproved?: number | null;
  unitPriceCents?: number | null;
  notes?: string | null;
  product: { id: string; code: string; name: string; unit?: string | null };
}

export interface PurchaseRequestRow {
  id: string;
  requestNumber: string;
  status: string;
  requiresApproval: boolean;
  requestedAt: string;
  requestedBy?: string | null;
  notes?: string | null;
  createdAt: string;
  department?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  items: RequestItem[];
  purchaseOrder?: { id: string; poNumber: string; status: string } | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  unitPriceCents: number;
  notes?: string | null;
  product: { id: string; code: string; name: string; unit?: string | null };
}

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  status: string;
  orderDate?: string | null;
  expectedDate?: string | null;
  totalCents: number;
  notes?: string | null;
  createdAt: string;
  vendor: { id: string; name: string; code?: string };
  purchaseRequest?: { id: string; requestNumber: string; status?: string } | null;
  items: OrderItem[];
  goodsReceipts?: { id: string; grnNumber: string; status: string; receivedAt: string | null }[];
  _count?: { goodsReceipts: number };
}

export interface GoodsReceiptRow {
  id: string;
  grnNumber: string;
  status: string;
  receivedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  vendor: { id: string; name: string; code?: string };
  po?: { id: string; poNumber: string; status?: string } | null;
  items?: {
    id: string;
    quantityReceived: number;
    unitPriceCents: number;
    poItemId?: string | null;
    product: { id: string; code: string; name: string; unit?: string | null };
    location: { id: string; code: string; name: string };
  }[];
  _count?: { items: number };
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface AssetAssignmentRow {
  id: string;
  assigneeType: string;
  assigneeName?: string | null;
  status: string;
  assignedAt: string;
  returnedAt?: string | null;
  notes?: string | null;
  employee?: { id: string; employeeCode?: string; firstName: string; lastName?: string | null } | null;
  department?: { id: string; name: string } | null;
  campus?: { id: string; name: string } | null;
}

export interface AssetRow {
  id: string;
  assetCode: string;
  tagNumber: string;
  name: string;
  description?: string | null;
  serialNumber?: string | null;
  brand?: string | null;
  modelName?: string | null;
  status: string;
  condition: string;
  depreciationMethod: string;
  usefulLifeMonths?: number | null;
  purchaseDate?: string | null;
  purchaseCostCents?: number | null;
  salvageValueCents?: number | null;
  currentBookValueCents?: number | null;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  warrantyProvider?: string | null;
  notes?: string | null;
  createdAt: string;
  category?: { id: string; code: string; name: string; kind?: string } | null;
  location?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  assignments?: AssetAssignmentRow[];
  maintenanceRecords?: MaintenanceRow[];
  warrantyClaims?: WarrantyClaimRow[];
  depreciationEntries?: DepreciationEntryRow[];
  disposals?: DisposalRow[];
}

export interface MaintenanceRow {
  id: string;
  maintenanceNumber: string;
  type: string;
  status: string;
  scheduledDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  description?: string | null;
  costCents?: number | null;
  performedBy?: string | null;
  notes?: string | null;
  asset?: { id: string; assetCode: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
}

export interface WarrantyClaimRow {
  id: string;
  claimNumber: string;
  status: string;
  description: string;
  costCents?: number | null;
  resolution?: string | null;
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  asset?: { id: string; assetCode: string; name: string } | null;
}

export interface DepreciationEntryRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  method: string;
  openingBookValueCents: number;
  depreciationCents: number;
  closingBookValueCents: number;
}

export interface DisposalRow {
  id: string;
  disposalNumber: string;
  type: string;
  status: string;
  disposalDate?: string | null;
  proceedsCents?: number | null;
  remarks?: string | null;
  asset?: { id: string; assetCode: string; name: string } | null;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface InventorySummary {
  vendors: number;
  categories: number;
  productCategories: number;
  assetCategories: number;
  products: number;
  locations: number;
  totalUnits: number;
  stockValueCents: number;
  lowStockCount: number;
  purchaseRequestStatuses: { status: string; _count: { _all: number } }[];
  pendingApprovals: number;
  openPurchaseOrders: number;
  assets: number;
  assignedAssets: number;
  underMaintenance: number;
  disposedAssets: number;
}

export interface StockReport {
  byLocation: { locationId: string; locationName: string; type: string; items: number; units: number; valueCents: number; lowStockItems: number }[];
  byCategory: { categoryId: string; categoryName: string; items: number; units: number; valueCents: number; lowStockItems: number }[];
}

export interface AssetReport {
  totalAssets: number;
  totalCostCents: number;
  totalBookValueCents: number;
  byStatus: { status: string; count: number; costCents: number; bookValueCents: number }[];
  byCategory: { categoryId: string; categoryName: string; count: number; costCents: number; bookValueCents: number }[];
}
