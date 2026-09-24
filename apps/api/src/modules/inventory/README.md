# Inventory module (`inventory` feature flag)

Inventory & Asset Management: vendors, product categories, products, storage locations, the
stock ledger (receipts via goods receipts, transfers, adjustments), the purchase flow (requests
with a lightweight approval state machine → purchase orders → goods receipts that post stock on
completion), and fixed assets (registration, assignment, maintenance, warranty claims,
straight-line depreciation and disposal). Reports + lookups back a tabbed frontend under
`apps/web/src/routes/inventory.tsx`.

## Design notes

- **Two distinct tracks.** Consumables/stock are tracked per location with an append-only ledger
  (`InventoryStockMovement` writes `quantityBefore`/`quantityAfter` transactionally with the
  `InventoryStockItem` balance update, so history never diverges from balances). Fixed assets are
  capitalized (tag/asset codes, serial, purchase cost/date, warranty window), assigned, maintained
  and eventually disposed or written off.
- **Tenant + RBAC.** All routes sit behind `JwtAuthGuard + TenantMatchGuard + PermissionsGuard +
  FeatureFlagsGuard` with `@RequireFeature('inventory')`. Permissions used: `inventory.view`,
  `inventory.create`, `inventory.update`, `inventory.delete`, `inventory.manage` (approve/reject
  purchase requests, issue purchase orders, convert request → PO). Catalog and asset records are
  shared tenant resources — there is no campus/department data separation, so no permission-scope
  filters are needed (mirrors the library catalog).
- **Approvals are a self-contained state machine.** A purchase request moves
  DRAFT → PENDING_APPROVAL → APPROVED/REJECTED (→ CONVERTED once a PO is created from it). This is
  an intentional first tier; wiring it into the WorkflowModule is a future enhancement.
- **Receipts post stock.** Completing a goods receipt upserts balances, writes `RECEIPT` ledger
  rows, validates no over-receive vs. purchase-order lines, and rolls the PO status forward
  (ISSUED → PARTIALLY_RECEIVED → RECEIVED).
- **Depreciation.** `POST /inventory/assets/depreciation/run` generates monthly straight-line
  entries for eligible assets; the `@@unique([tenantId, assetId, periodStart])` guard makes the run
  idempotent per accounting period. Book value = purchase cost − Σ entries.
- **Audit.** Every mutation writes an `AUDIT_MODULES.INVENTORY` audit record (`packages/auth/
  src/audit-keys.ts` — new `INVENTORY_*` actions; rebuild `@college-erp/auth` if it changes again).
- **Sequence numbers.** Atomic per-tenant series allocator (`inventory-sequences.ts`, same contract
  as library/fee sequences) mints vendor/category/product/location codes and PR/PO/GRN/transfer/
  adjustment numbers plus asset codes (`AST-…`), tags (`TAG-…`), maintenance (`MNT-…`), warranty
  (`WRN-…`) and disposal (`DSP-…`) numbers inside the caller's `$transaction`.

## Schema

- Models added to `packages/database/prisma/schema.prisma`: `InventorySequence`, `InventoryCategory`,
  `InventoryVendor`, `InventoryProduct`, `InventoryLocation`, `InventoryStockItem`,
  `InventoryStockMovement`, `InventoryPurchaseRequest` (+items), `InventoryPurchaseOrder` (+items),
  `InventoryGoodsReceipt` (+items), `InventoryStockTransfer` (+items), `InventoryStockAdjustment`
  (+items), `InventoryAsset`, `InventoryAssetAssignment`, `InventoryAssetMaintenance`,
  `InventoryAssetWarrantyClaim`, `InventoryAssetDepreciationEntry`, `InventoryAssetDisposal`.
- Migration: `packages/database/prisma/migrations/20261001000000_add_inventory_module/migration.sql`
  (generated offline with `prisma migrate diff`). Apply once a database is available:

  ```sh
  pnpm db:generate   # regenerate client (already run after the schema edit)
  pnpm db:migrate    # prisma migrate dev (or prisma migrate deploy on a server)
  ```