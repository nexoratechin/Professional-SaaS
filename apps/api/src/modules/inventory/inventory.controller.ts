/**
 * Inventory & Asset Management controller — vendors, categories, products, locations, stock
 * balances + ledger, purchases (requests → approvals → purchase orders → goods receipts), and
 * fixed assets (assignment, maintenance, warranty, depreciation, disposal), plus reports and
 * lookups for the frontend. Guards follow the feature-module convention; approval/issue
 * mutations require MANAGE, stock-posting/closing mutations require UPDATE, and static
 * sub-routes (lookups, reports, 'maintenance', 'warranty-claims', 'disposals',
 * 'depreciation/run') are declared before parameter routes so NestJS never treats them as :id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { InventoryService } from './inventory.service';
import {
  AssignAssetDto,
  CompleteDisposalDto,
  CreateDisposalDto,
  CreateInventoryAssetDto,
  CreateInventoryCategoryDto,
  CreateInventoryGoodsReceiptDto,
  CreateInventoryLocationDto,
  CreateInventoryMaintenanceDto,
  CreateInventoryProductDto,
  CreateInventoryPurchaseOrderDto,
  CreateInventoryPurchaseRequestDto,
  CreateInventoryStockAdjustmentDto,
  CreateInventoryStockTransferDto,
  CreateInventoryVendorDto,
  CreateWarrantyClaimDto,
  InventoryPaginationDto,
  InventoryReportQueryDto,
  ListAssetsDto,
  ListInventoryCategoriesDto,
  ListInventoryDocsDto,
  ListProductsDto,
  ListStockItemsDto,
  ListStockMovementsDto,
  RejectInventoryPurchaseRequestDto,
  ReturnAssetDto,
  RunDepreciationDto,
  SetInventoryMaintenanceStatusDto,
  SetWarrantyClaimStatusDto,
  UpdateInventoryAssetDto,
  UpdateInventoryCategoryDto,
  UpdateInventoryLocationDto,
  UpdateInventoryMaintenanceDto,
  UpdateInventoryProductDto,
  UpdateInventoryPurchaseOrderDto,
  UpdateInventoryPurchaseRequestDto,
  UpdateInventoryVendorDto,
  UpdateWarrantyClaimDto,
} from './dto/inventory.dto';

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.INVENTORY)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups & reports ─────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.INVENTORY_VIEW)
  lookups() {
    return this.inventoryService.lookups(this.tid());
  }

  @Get('reports/summary')
  @RequirePermission(K.INVENTORY_VIEW)
  reportsSummary(@Query() q: InventoryReportQueryDto) {
    return this.inventoryService.reportsSummary(this.tid(), q);
  }

  @Get('reports/stock')
  @RequirePermission(K.INVENTORY_VIEW)
  reportsStock() {
    return this.inventoryService.reportsStock(this.tid());
  }

  @Get('reports/assets')
  @RequirePermission(K.INVENTORY_VIEW)
  reportsAssets() {
    return this.inventoryService.reportsAssets(this.tid());
  }

  // ── Vendors ───────────────────────────────────────────────────────────────

  @Get('vendors')
  @RequirePermission(K.INVENTORY_VIEW)
  listVendors(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listVendors(this.tid(), q);
  }

  @Post('vendors')
  @RequirePermission(K.INVENTORY_CREATE)
  createVendor(@Body() dto: CreateInventoryVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createVendor(this.tid(), user.id, dto);
  }

  @Patch('vendors/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateVendor(@Param('id') id: string, @Body() dto: UpdateInventoryVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateVendor(this.tid(), user.id, id, dto);
  }

  @Delete('vendors/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deleteVendor(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deleteVendor(this.tid(), user.id, id);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermission(K.INVENTORY_VIEW)
  listCategories(@Query() q: ListInventoryCategoriesDto) {
    return this.inventoryService.listCategories(this.tid(), q);
  }

  @Post('categories')
  @RequirePermission(K.INVENTORY_CREATE)
  createCategory(@Body() dto: CreateInventoryCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createCategory(this.tid(), user.id, dto);
  }

  @Patch('categories/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateCategory(@Param('id') id: string, @Body() dto: UpdateInventoryCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateCategory(this.tid(), user.id, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deleteCategory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deleteCategory(this.tid(), user.id, id);
  }

  // ── Products ──────────────────────────────────────────────────────────────

  @Get('products')
  @RequirePermission(K.INVENTORY_VIEW)
  listProducts(@Query() q: ListProductsDto) {
    return this.inventoryService.listProducts(this.tid(), q);
  }

  @Post('products')
  @RequirePermission(K.INVENTORY_CREATE)
  createProduct(@Body() dto: CreateInventoryProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createProduct(this.tid(), user.id, dto);
  }

  @Get('products/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getProduct(@Param('id') id: string) {
    return this.inventoryService.getProduct(this.tid(), id);
  }

  @Patch('products/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateProduct(@Param('id') id: string, @Body() dto: UpdateInventoryProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateProduct(this.tid(), user.id, id, dto);
  }

  @Delete('products/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deleteProduct(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deleteProduct(this.tid(), user.id, id);
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  @Get('locations')
  @RequirePermission(K.INVENTORY_VIEW)
  listLocations(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listLocations(this.tid(), q);
  }

  @Post('locations')
  @RequirePermission(K.INVENTORY_CREATE)
  createLocation(@Body() dto: CreateInventoryLocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createLocation(this.tid(), user.id, dto);
  }

  @Patch('locations/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateLocation(@Param('id') id: string, @Body() dto: UpdateInventoryLocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateLocation(this.tid(), user.id, id, dto);
  }

  @Delete('locations/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deleteLocation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deleteLocation(this.tid(), user.id, id);
  }

  // ── Stock ─────────────────────────────────────────────────────────────────

  @Get('stock')
  @RequirePermission(K.INVENTORY_VIEW)
  listStockItems(@Query() q: ListStockItemsDto) {
    return this.inventoryService.listStockItems(this.tid(), q);
  }

  @Get('stock/movements')
  @RequirePermission(K.INVENTORY_VIEW)
  listStockMovements(@Query() q: ListStockMovementsDto) {
    return this.inventoryService.listStockMovements(this.tid(), q);
  }

  @Get('stock/transfers')
  @RequirePermission(K.INVENTORY_VIEW)
  listStockTransfers(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listStockTransfers(this.tid(), q);
  }

  @Post('stock/transfers')
  @RequirePermission(K.INVENTORY_CREATE)
  createStockTransfer(@Body() dto: CreateInventoryStockTransferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createStockTransfer(this.tid(), user.id, dto);
  }

  @Get('stock/transfers/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getStockTransfer(@Param('id') id: string) {
    return this.inventoryService.getStockTransfer(this.tid(), id);
  }

  @Post('stock/transfers/:id/complete')
  @RequirePermission(K.INVENTORY_UPDATE)
  completeStockTransfer(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.completeStockTransfer(this.tid(), user.id, id);
  }

  @Post('stock/transfers/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelStockTransfer(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelStockTransfer(this.tid(), user.id, id);
  }

  @Get('stock/adjustments')
  @RequirePermission(K.INVENTORY_VIEW)
  listStockAdjustments(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listStockAdjustments(this.tid(), q);
  }

  @Post('stock/adjustments')
  @RequirePermission(K.INVENTORY_CREATE)
  createStockAdjustment(@Body() dto: CreateInventoryStockAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createStockAdjustment(this.tid(), user.id, dto);
  }

  @Get('stock/adjustments/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getStockAdjustment(@Param('id') id: string) {
    return this.inventoryService.getStockAdjustment(this.tid(), id);
  }

  @Post('stock/adjustments/:id/complete')
  @RequirePermission(K.INVENTORY_UPDATE)
  completeStockAdjustment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.completeStockAdjustment(this.tid(), user.id, id);
  }

  @Post('stock/adjustments/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelStockAdjustment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelStockAdjustment(this.tid(), user.id, id);
  }

  // ── Goods receipts ────────────────────────────────────────────────────────

  @Get('goods-receipts')
  @RequirePermission(K.INVENTORY_VIEW)
  listGoodsReceipts(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listGoodsReceipts(this.tid(), q);
  }

  @Post('goods-receipts')
  @RequirePermission(K.INVENTORY_CREATE)
  createGoodsReceipt(@Body() dto: CreateInventoryGoodsReceiptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createGoodsReceipt(this.tid(), user.id, dto);
  }

  @Get('goods-receipts/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getGoodsReceipt(@Param('id') id: string) {
    return this.inventoryService.getGoodsReceipt(this.tid(), id);
  }

  @Post('goods-receipts/:id/complete')
  @RequirePermission(K.INVENTORY_UPDATE)
  completeGoodsReceipt(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.completeGoodsReceipt(this.tid(), user.id, id);
  }

  @Post('goods-receipts/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelGoodsReceipt(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelGoodsReceipt(this.tid(), user.id, id);
  }

  // ── Purchase requests ─────────────────────────────────────────────────────

  @Get('purchase-requests')
  @RequirePermission(K.INVENTORY_VIEW)
  listPurchaseRequests(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listPurchaseRequests(this.tid(), q);
  }

  @Post('purchase-requests')
  @RequirePermission(K.INVENTORY_CREATE)
  createPurchaseRequest(@Body() dto: CreateInventoryPurchaseRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createPurchaseRequest(this.tid(), user.id, dto);
  }

  @Get('purchase-requests/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getPurchaseRequest(@Param('id') id: string) {
    return this.inventoryService.getPurchaseRequest(this.tid(), id);
  }

  @Patch('purchase-requests/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updatePurchaseRequest(@Param('id') id: string, @Body() dto: UpdateInventoryPurchaseRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updatePurchaseRequest(this.tid(), user.id, id, dto);
  }

  @Post('purchase-requests/:id/submit')
  @RequirePermission(K.INVENTORY_UPDATE)
  submitPurchaseRequest(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.submitPurchaseRequest(this.tid(), user.id, id);
  }

  @Post('purchase-requests/:id/approve')
  @RequirePermission(K.INVENTORY_MANAGE)
  approvePurchaseRequest(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.approvePurchaseRequest(this.tid(), user.id, id);
  }

  @Post('purchase-requests/:id/reject')
  @RequirePermission(K.INVENTORY_MANAGE)
  rejectPurchaseRequest(@Param('id') id: string, @Body() dto: RejectInventoryPurchaseRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.rejectPurchaseRequest(this.tid(), user.id, id, dto);
  }

  @Post('purchase-requests/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelPurchaseRequest(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelPurchaseRequest(this.tid(), user.id, id);
  }

  @Delete('purchase-requests/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deletePurchaseRequest(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deletePurchaseRequest(this.tid(), user.id, id);
  }

  // ── Purchase orders ───────────────────────────────────────────────────────

  @Post('purchase-orders/from-request/:requestId')
  @RequirePermission(K.INVENTORY_MANAGE)
  createPurchaseOrderFromRequest(@Param('requestId') requestId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createPurchaseOrderFromRequest(this.tid(), user.id, requestId);
  }

  @Get('purchase-orders')
  @RequirePermission(K.INVENTORY_VIEW)
  listPurchaseOrders(@Query() q: InventoryPaginationDto) {
    return this.inventoryService.listPurchaseOrders(this.tid(), q);
  }

  @Post('purchase-orders')
  @RequirePermission(K.INVENTORY_CREATE)
  createPurchaseOrder(@Body() dto: CreateInventoryPurchaseOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createPurchaseOrder(this.tid(), user.id, dto);
  }

  @Get('purchase-orders/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getPurchaseOrder(@Param('id') id: string) {
    return this.inventoryService.getPurchaseOrder(this.tid(), id);
  }

  @Patch('purchase-orders/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updatePurchaseOrder(@Param('id') id: string, @Body() dto: UpdateInventoryPurchaseOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updatePurchaseOrder(this.tid(), user.id, id, dto);
  }

  @Post('purchase-orders/:id/issue')
  @RequirePermission(K.INVENTORY_MANAGE)
  issuePurchaseOrder(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.issuePurchaseOrder(this.tid(), user.id, id);
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelPurchaseOrder(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelPurchaseOrder(this.tid(), user.id, id);
  }

  // ── Assets (static sub-routes before :id routes) ──────────────────────────

  @Get('assets')
  @RequirePermission(K.INVENTORY_VIEW)
  listAssets(@Query() q: ListAssetsDto) {
    return this.inventoryService.listAssets(this.tid(), q);
  }

  @Post('assets')
  @RequirePermission(K.INVENTORY_CREATE)
  createAsset(@Body() dto: CreateInventoryAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createAsset(this.tid(), user.id, dto);
  }

  @Get('assets/maintenance')
  @RequirePermission(K.INVENTORY_VIEW)
  listMaintenanceRecords(@Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listMaintenanceRecords(this.tid(), q);
  }

  @Get('assets/warranty-claims')
  @RequirePermission(K.INVENTORY_VIEW)
  listWarrantyClaims(@Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listWarrantyClaims(this.tid(), q);
  }

  @Get('assets/disposals')
  @RequirePermission(K.INVENTORY_VIEW)
  listDisposals(@Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listDisposals(this.tid(), q);
  }

  @Post('assets/depreciation/run')
  @RequirePermission(K.INVENTORY_UPDATE)
  runDepreciation(@Body() dto: RunDepreciationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.runDepreciation(this.tid(), user.id, dto);
  }

  @Get('assets/:id')
  @RequirePermission(K.INVENTORY_VIEW)
  getAsset(@Param('id') id: string) {
    return this.inventoryService.getAsset(this.tid(), id);
  }

  @Patch('assets/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateAsset(@Param('id') id: string, @Body() dto: UpdateInventoryAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateAsset(this.tid(), user.id, id, dto);
  }

  @Delete('assets/:id')
  @RequirePermission(K.INVENTORY_DELETE)
  deleteAsset(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.deleteAsset(this.tid(), user.id, id);
  }

  @Post('assets/:id/assign')
  @RequirePermission(K.INVENTORY_UPDATE)
  assignAsset(@Param('id') id: string, @Body() dto: AssignAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.assignAsset(this.tid(), user.id, id, dto);
  }

  @Post('assets/:id/return')
  @RequirePermission(K.INVENTORY_UPDATE)
  returnAsset(@Param('id') id: string, @Body() dto: ReturnAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.returnAsset(this.tid(), user.id, id, dto);
  }

  @Get('assets/:id/depreciation')
  @RequirePermission(K.INVENTORY_VIEW)
  listDepreciationEntries(@Param('id') id: string) {
    return this.inventoryService.listDepreciationEntries(this.tid(), id);
  }

  @Get('assets/:id/maintenance')
  @RequirePermission(K.INVENTORY_VIEW)
  listAssetMaintenance(@Param('id') id: string, @Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listMaintenanceRecords(this.tid(), { ...q, assetId: id });
  }

  @Post('assets/:id/maintenance')
  @RequirePermission(K.INVENTORY_CREATE)
  createMaintenance(@Param('id') id: string, @Body() dto: CreateInventoryMaintenanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createMaintenance(this.tid(), user.id, id, dto);
  }

  @Patch('assets/maintenance/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateMaintenance(@Param('id') id: string, @Body() dto: UpdateInventoryMaintenanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateMaintenance(this.tid(), user.id, id, dto);
  }

  @Post('assets/maintenance/:id/status')
  @RequirePermission(K.INVENTORY_UPDATE)
  setMaintenanceStatus(@Param('id') id: string, @Body() dto: SetInventoryMaintenanceStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.setMaintenanceStatus(this.tid(), user.id, id, dto);
  }

  @Get('assets/:id/warranty-claims')
  @RequirePermission(K.INVENTORY_VIEW)
  listAssetWarrantyClaims(@Param('id') id: string, @Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listWarrantyClaims(this.tid(), { ...q, assetId: id });
  }

  @Post('assets/:id/warranty-claims')
  @RequirePermission(K.INVENTORY_CREATE)
  createWarrantyClaim(@Param('id') id: string, @Body() dto: CreateWarrantyClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createWarrantyClaim(this.tid(), user.id, id, dto);
  }

  @Patch('assets/warranty-claims/:id')
  @RequirePermission(K.INVENTORY_UPDATE)
  updateWarrantyClaim(@Param('id') id: string, @Body() dto: UpdateWarrantyClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.updateWarrantyClaim(this.tid(), user.id, id, dto);
  }

  @Post('assets/warranty-claims/:id/status')
  @RequirePermission(K.INVENTORY_UPDATE)
  setWarrantyClaimStatus(@Param('id') id: string, @Body() dto: SetWarrantyClaimStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.setWarrantyClaimStatus(this.tid(), user.id, id, dto);
  }

  @Get('assets/:id/disposals')
  @RequirePermission(K.INVENTORY_VIEW)
  listAssetDisposals(@Param('id') id: string, @Query() q: ListInventoryDocsDto) {
    return this.inventoryService.listDisposals(this.tid(), { ...q, assetId: id });
  }

  @Post('assets/:id/disposals')
  @RequirePermission(K.INVENTORY_CREATE)
  createDisposal(@Param('id') id: string, @Body() dto: CreateDisposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createDisposal(this.tid(), user.id, id, dto);
  }

  @Post('assets/disposals/:id/complete')
  @RequirePermission(K.INVENTORY_UPDATE)
  completeDisposal(@Param('id') id: string, @Body() dto: CompleteDisposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.completeDisposal(this.tid(), user.id, id, dto);
  }

  @Post('assets/disposals/:id/cancel')
  @RequirePermission(K.INVENTORY_UPDATE)
  cancelDisposal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.cancelDisposal(this.tid(), user.id, id);
  }
}