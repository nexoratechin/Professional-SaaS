/**
 * Inventory & Asset Management service — vendors, product categories, products, storage
 * locations, the stock ledger (receipts via goods receipts, transfers, adjustments), the
 * purchase flow (requests with a lightweight approval state machine → purchase orders →
 * goods receipts that post stock on completion), and fixed assets (registration, assignment,
 * maintenance, warranty claims, straight-line depreciation and disposal). Catalog and asset
 * records are shared tenant resources gated purely by the inventory.* permissions — there is
 * no campus/department data-separation (like the library catalog), so no permission-scope
 * filters are needed. Every mutation lands an audit event (module 'inventory').
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type InventorySequenceKind,
  type PrismaClient,
} from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { nextInventorySeriesNumber } from './inventory-sequences';
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
  InventoryReportQueryDto,
  ListAssetsDto,
  ListInventoryCategoriesDto,
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

type Client = PrismaClient;

const NON_ASSIGNABLE_ASSET_STATUSES = ['DISPOSED', 'DECOMMISSIONED', 'WRITTEN_OFF'];
const ACTIVE_ASSIGNMENT_STATUS = 'ACTIVE' as const;
const OPEN_MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS'];

function monthStart(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

function monthEnd(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get db(): Client {
    return this.tenantPrisma.client as unknown as Client;
  }

  private async audit(tenantId: string, userId: string, action: string, entityType: string, entityId: string | undefined, extra?: { before?: unknown; after?: unknown }) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: AUDIT_MODULES.INVENTORY,
      entityType,
      entityId,
      before: extra?.before,
      after: extra?.after,
    });
  }

  private async page(model: any, where: any, orderBy: any, skip = 0, take = 50, include?: any) {
    const [items, total] = await Promise.all([
      model.findMany({ where, orderBy, skip, take, include }),
      model.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  private async nextNumber(tx: any, tenantId: string, kind: InventorySequenceKind, prefix: string) {
    return nextInventorySeriesNumber(tx, tenantId, kind, prefix);
  }

  // ── Stock movement helper (ledger + balance in one transaction) ───────────

  private async applyMovement(
    tx: any,
    tenantId: string,
    userId: string,
    data: {
      productId: string;
      locationId: string;
      type: 'INITIAL' | 'RECEIPT' | 'ISSUE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT_ADD' | 'ADJUSTMENT_SUBTRACT';
      quantityDelta: number;
      reason?: string;
      referenceType?: string;
      referenceId?: string;
      notes?: string;
      occurredAt?: Date;
    },
  ) {
    const now = data.occurredAt ?? new Date();
    const existing = await tx.inventoryStockItem.findFirst({
      where: { tenantId, productId: data.productId, locationId: data.locationId },
      select: { quantityOnHand: true },
    });
    const before = existing?.quantityOnHand ?? 0;
    const after = before + data.quantityDelta;
    if (after < 0) {
      throw new BadRequestException('Insufficient stock to complete this operation');
    }
    if (existing) {
      await tx.inventoryStockItem.update({
        where: { id: existing.id },
        data: { quantityOnHand: after, lastMovementAt: now },
      });
    } else if (data.quantityDelta !== 0) {
      await tx.inventoryStockItem.create({
        data: {
          tenant: { connect: { id: tenantId } },
          product: { connect: { id: data.productId } },
          location: { connect: { id: data.locationId } },
          quantityOnHand: after,
          lastMovementAt: now,
        },
      });
    }
    await tx.inventoryStockMovement.create({
      data: {
        tenant: { connect: { id: tenantId } },
        product: { connect: { id: data.productId } },
        location: { connect: { id: data.locationId } },
        type: data.type,
        quantityDelta: data.quantityDelta,
        quantityBefore: before,
        quantityAfter: after,
        reason: data.reason,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        notes: data.notes,
        postedBy: userId,
        occurredAt: now,
      },
    });
    return after;
  }

  private async restoreAssetStatus(db: any, assetId: string) {
    const [assignment, maintenance] = await Promise.all([
      db.inventoryAssetAssignment.findFirst({ where: { assetId, status: ACTIVE_ASSIGNMENT_STATUS }, select: { id: true } }),
      db.inventoryAssetMaintenance.findFirst({ where: { assetId, status: { in: OPEN_MAINTENANCE_STATUSES as any } }, select: { id: true } }),
    ]);
    const status = maintenance ? 'UNDER_MAINTENANCE' : assignment ? 'ASSIGNED' : 'IN_STOCK';
    await db.inventoryAsset.update({ where: { id: assetId }, data: { status } });
    return status;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  async lookups(_tenantId: string) {
    const [vendors, categories, products, locations, campuses, departments, employees] = await Promise.all([
      this.db.inventoryVendor.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, gstin: true, paymentTerms: true } }),
      this.db.inventoryCategory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, kind: true, code: true, name: true, parentId: true } }),
      this.db.inventoryProduct.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, unit: true, unitPriceCents: true, categoryId: true } }),
      this.db.inventoryLocation.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, type: true, campusId: true } }),
      this.db.campus.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
      this.db.department.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, campusId: true } }),
      this.db.employee.findMany({ where: { deletedAt: null }, orderBy: { firstName: 'asc' }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } }),
    ]);
    return {
      vendors,
      categories,
      products,
      locations,
      campuses,
      departments,
      employees: employees.map((e) => ({ ...e, fullName: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') })),
      categoryKinds: ['PRODUCT', 'ASSET'],
      vendorStatuses: ['ACTIVE', 'INACTIVE'],
      locationTypes: ['WAREHOUSE', 'STORE', 'LAB', 'ROOM', 'OTHER'],
      stockMovementTypes: ['INITIAL', 'RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUBTRACT'],
      purchaseRequestStatuses: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'],
      purchaseOrderStatuses: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
      goodsReceiptStatuses: ['DRAFT', 'COMPLETED', 'CANCELLED'],
      stockTransferStatuses: ['PENDING', 'COMPLETED', 'CANCELLED'],
      stockAdjustmentStatuses: ['DRAFT', 'COMPLETED', 'CANCELLED'],
      assetStatuses: ['IN_STOCK', 'ASSIGNED', 'UNDER_MAINTENANCE', 'DECOMMISSIONED', 'DISPOSED', 'WRITTEN_OFF'],
      assetConditions: ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'DISPOSED'],
      depreciationMethods: ['NONE', 'STRAIGHT_LINE'],
      assignmentTypes: ['EMPLOYEE', 'DEPARTMENT', 'CAMPUS', 'OTHER'],
      maintenanceTypes: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'OTHER'],
      maintenanceStatuses: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      warrantyClaimStatuses: ['OPEN', 'APPROVED', 'REPAIRED', 'REJECTED', 'CLOSED'],
      disposalTypes: ['SALE', 'SCRAP', 'DONATION', 'RETURN_TO_VENDOR'],
      disposalStatuses: ['DRAFT', 'COMPLETED', 'CANCELLED'],
    };
  }

  // ── Vendors ───────────────────────────────────────────────────────────────

  async listVendors(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = { deletedAt: null };
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { code: { contains: page.search, mode: 'insensitive' } }, { gstin: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryVendor, where, { name: 'asc' }, page.skip ?? 0, page.take ?? 50);
  }

  async createVendor(tenantId: string, userId: string, dto: CreateInventoryVendorDto) {
    const row = await this.db.$transaction(async (tx) => {
      const vendor = await tx.inventoryVendor.create({
        data: {
          tenant: { connect: { id: tenantId } },
          code: dto.code || (await this.nextNumber(tx, tenantId, 'VENDOR', 'VEN')),
          name: dto.name,
          gstin: dto.gstin,
          contactPerson: dto.contactPerson,
          phone: dto.phone,
          email: dto.email,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          city: dto.city,
          state: dto.state,
          postalCode: dto.postalCode,
          country: dto.country ?? 'India',
          website: dto.website,
          paymentTerms: dto.paymentTerms,
          status: (dto.status as any) ?? 'ACTIVE',
          notes: dto.notes,
          createdBy: userId,
        },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_VENDOR_CREATED, 'InventoryVendor', vendor.id);
      return vendor;
    });
    return row;
  }

  async updateVendor(tenantId: string, userId: string, id: string, dto: UpdateInventoryVendorDto) {
    const before = await this.db.inventoryVendor.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Vendor not found');
    const row = await this.db.inventoryVendor.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        gstin: dto.gstin,
        contactPerson: dto.contactPerson,
        phone: dto.phone,
        email: dto.email,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        country: dto.country,
        website: dto.website,
        paymentTerms: dto.paymentTerms,
        status: dto.status as any,
        notes: dto.notes,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_VENDOR_UPDATED, 'InventoryVendor', id, { before, after: row });
    return row;
  }

  async deleteVendor(tenantId: string, userId: string, id: string) {
    const vendor = await this.db.inventoryVendor.findFirst({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const row = await this.db.inventoryVendor.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_VENDOR_DELETED, 'InventoryVendor', id);
    return row;
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(tenantId: string, q: ListInventoryCategoriesDto) {
    const where: any = { deletedAt: null };
    if (q.kind) where.kind = q.kind;
    return this.db.inventoryCategory.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { products: true, assets: true } } } });
  }

  async createCategory(tenantId: string, userId: string, dto: CreateInventoryCategoryDto) {
    const row = await this.db.$transaction(async (tx) => {
      const data: any = {
        tenant: { connect: { id: tenantId } },
        kind: dto.kind,
        code: dto.code || (await this.nextNumber(tx, tenantId, 'CATEGORY', 'CAT')),
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
        createdBy: userId,
      };
      const category = await tx.inventoryCategory.create({ data });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_CATEGORY_CREATED, 'InventoryCategory', category.id);
      return category;
    });
    return row;
  }

  async updateCategory(tenantId: string, userId: string, id: string, dto: UpdateInventoryCategoryDto) {
    const before = await this.db.inventoryCategory.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const row = await this.db.inventoryCategory.update({
      where: { id },
      data: { code: dto.code, name: dto.name, description: dto.description, parentId: dto.parentId, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_CATEGORY_UPDATED, 'InventoryCategory', id, { before, after: row });
    return row;
  }

  async deleteCategory(tenantId: string, userId: string, id: string) {
    const category = await this.db.inventoryCategory.findFirst({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    const [products, assets, children] = await Promise.all([
      this.db.inventoryProduct.count({ where: { categoryId: id, deletedAt: null } }),
      this.db.inventoryAsset.count({ where: { categoryId: id, deletedAt: null } }),
      this.db.inventoryCategory.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (products > 0 || assets > 0 || children > 0) {
      throw new ConflictException('Category still has products, assets or child categories');
    }
    const row = await this.db.inventoryCategory.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_CATEGORY_DELETED, 'InventoryCategory', id);
    return row;
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(tenantId: string, q: ListProductsDto) {
    const where: any = { deletedAt: null };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryProduct, where, { name: 'asc' }, q.skip ?? 0, q.take ?? 50, {
      category: { select: { id: true, code: true, name: true } },
      _count: { select: { stockItems: true } },
    });
  }

  async createProduct(tenantId: string, userId: string, dto: CreateInventoryProductDto) {
    const category = await this.db.inventoryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null, kind: 'PRODUCT' } });
    if (!category) throw new BadRequestException('Valid product category is required');
    const row = await this.db.$transaction(async (tx) => {
      const product = await tx.inventoryProduct.create({
        data: {
          tenant: { connect: { id: tenantId } },
          category: { connect: { id: dto.categoryId } },
          code: dto.code || (await this.nextNumber(tx, tenantId, 'PRODUCT', 'PRD')),
          sku: dto.sku,
          name: dto.name,
          description: dto.description,
          unit: dto.unit ?? 'PCS',
          unitPriceCents: dto.unitPriceCents,
          reorderLevel: dto.reorderLevel ?? 0,
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PRODUCT_CREATED, 'InventoryProduct', product.id);
      return product;
    });
    return row;
  }

  async getProduct(tenantId: string, id: string) {
    const product = await this.db.inventoryProduct.findFirst({
      where: { id },
      include: { category: { select: { id: true, code: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async updateProduct(tenantId: string, userId: string, id: string, dto: UpdateInventoryProductDto) {
    const before = await this.db.inventoryProduct.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Product not found');
    if (dto.categoryId) {
      const category = await this.db.inventoryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null, kind: 'PRODUCT' } });
      if (!category) throw new BadRequestException('Valid product category is required');
    }
    const row = await this.db.inventoryProduct.update({
      where: { id },
      data: {
        code: dto.code,
        categoryId: dto.categoryId,
        sku: dto.sku,
        name: dto.name,
        description: dto.description,
        unit: dto.unit,
        unitPriceCents: dto.unitPriceCents,
        reorderLevel: dto.reorderLevel,
        isActive: dto.isActive,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PRODUCT_UPDATED, 'InventoryProduct', id, { before, after: row });
    return row;
  }

  async deleteProduct(tenantId: string, userId: string, id: string) {
    const product = await this.db.inventoryProduct.findFirst({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    const row = await this.db.inventoryProduct.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PRODUCT_DELETED, 'InventoryProduct', id);
    return row;
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  async listLocations(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = { deletedAt: null };
    if (page.search) where.OR = [{ name: { contains: page.search, mode: 'insensitive' } }, { code: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryLocation, where, { name: 'asc' }, page.skip ?? 0, page.take ?? 50, {
      campus: { select: { id: true, name: true } },
      building: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      _count: { select: { stockItems: true, assets: true } },
    });
  }

  async createLocation(tenantId: string, userId: string, dto: CreateInventoryLocationDto) {
    const row = await this.db.$transaction(async (tx) => {
      const data: any = {
        tenant: { connect: { id: tenantId } },
        code: dto.code || (await this.nextNumber(tx, tenantId, 'LOCATION', 'LOC')),
        name: dto.name,
        type: dto.type ?? 'STORE',
        campusId: dto.campusId,
        buildingId: dto.buildingId,
        roomId: dto.roomId,
        isActive: dto.isActive ?? true,
        notes: dto.notes,
        createdBy: userId,
      };
      const location = await tx.inventoryLocation.create({ data });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_LOCATION_CREATED, 'InventoryLocation', location.id);
      return location;
    });
    return row;
  }

  async updateLocation(tenantId: string, userId: string, id: string, dto: UpdateInventoryLocationDto) {
    const before = await this.db.inventoryLocation.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Location not found');
    const row = await this.db.inventoryLocation.update({
      where: { id },
      data: { code: dto.code, name: dto.name, type: dto.type as any, campusId: dto.campusId, buildingId: dto.buildingId, roomId: dto.roomId, isActive: dto.isActive, notes: dto.notes, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_LOCATION_UPDATED, 'InventoryLocation', id, { before, after: row });
    return row;
  }

  async deleteLocation(tenantId: string, userId: string, id: string) {
    const location = await this.db.inventoryLocation.findFirst({ where: { id } });
    if (!location) throw new NotFoundException('Location not found');
    const [stockItems, assets] = await Promise.all([
      this.db.inventoryStockItem.count({ where: { locationId: id } }),
      this.db.inventoryAsset.count({ where: { locationId: id, deletedAt: null } }),
    ]);
    if (stockItems > 0 || assets > 0) {
      throw new ConflictException('Location has stock or assets — deactivate it instead');
    }
    const row = await this.db.inventoryLocation.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_LOCATION_DELETED, 'InventoryLocation', id);
    return row;
  }

  // ── Stock (balances, movements) ───────────────────────────────────────────

  async listStockItems(tenantId: string, q: ListStockItemsDto) {
    const where: any = {};
    if (q.productId) where.productId = q.productId;
    if (q.locationId) where.locationId = q.locationId;
    const include = {
      product: { select: { id: true, code: true, name: true, unit: true, unitPriceCents: true, reorderLevel: true } },
      location: { select: { id: true, code: true, name: true, type: true } },
    };
    let items: any;
    let total: number;
    if (q.lowStock) {
      const candidates = await this.db.inventoryStockItem.findMany({
        where,
        include,
        orderBy: { updatedAt: 'desc' },
        skip: q.skip ?? 0,
        take: q.take ?? 50,
      });
      items = candidates.filter((s) => s.product.reorderLevel > 0 && s.quantityOnHand <= s.product.reorderLevel);
      total = items.length;
    } else {
      const [found, count] = await Promise.all([
        this.db.inventoryStockItem.findMany({ where, include, orderBy: { updatedAt: 'desc' }, skip: q.skip ?? 0, take: q.take ?? 50 }),
        this.db.inventoryStockItem.count({ where }),
      ]);
      items = found;
      total = count;
    }
    return { items, total, skip: q.skip ?? 0, take: q.take ?? 50 };
  }

  async listStockMovements(tenantId: string, q: ListStockMovementsDto) {
    const where: any = {};
    if (q.productId) where.productId = q.productId;
    if (q.locationId) where.locationId = q.locationId;
    if (q.type) where.type = q.type;
    return this.page(this.db.inventoryStockMovement, where, { occurredAt: 'desc' }, q.skip ?? 0, q.take ?? 50, {
      product: { select: { id: true, code: true, name: true, unit: true } },
      location: { select: { id: true, code: true, name: true } },
    });
  }

  // ── Purchase requests ─────────────────────────────────────────────────────

  async listPurchaseRequests(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = {};
    if (page.search) where.OR = [{ requestNumber: { contains: page.search, mode: 'insensitive' } }, { requestedBy: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryPurchaseRequest, where, { createdAt: 'desc' }, page.skip ?? 0, page.take ?? 50, {
      department: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true } },
    });
  }

  async getPurchaseRequest(tenantId: string, id: string) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
      },
    });
    if (!row) throw new NotFoundException('Purchase request not found');
    return row;
  }

  async createPurchaseRequest(tenantId: string, userId: string, dto: CreateInventoryPurchaseRequestDto) {
    const requiresApproval = dto.requiresApproval ?? true;
    const row = await this.db.$transaction(async (tx) => {
      const requestNumber = await this.nextNumber(tx, tenantId, 'PURCHASE_REQUEST', 'PR');
      const data: any = {
        tenant: { connect: { id: tenantId } },
        requestNumber,
        requestedBy: dto.requestedBy ?? userId,
        requestedAt: dto.requestedAt ? new Date(dto.requestedAt) : new Date(),
        departmentId: dto.departmentId,
        vendorId: dto.vendorId,
        requiresApproval,
        status: requiresApproval ? 'DRAFT' : 'APPROVED',
        approvedAt: requiresApproval ? null : new Date(),
        approvedById: requiresApproval ? null : userId,
        notes: dto.notes,
        createdBy: userId,
      };
      const request = await tx.inventoryPurchaseRequest.create({ data });
      for (const item of dto.items) {
        await tx.inventoryPurchaseRequestItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            request: { connect: { id: request.id } },
            product: { connect: { id: item.productId } },
            quantityRequested: item.quantityRequested,
            quantityApproved: requiresApproval ? null : item.quantityRequested,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_CREATED, 'InventoryPurchaseRequest', request.id);
      return request;
    });
    return this.getPurchaseRequest(tenantId, row.id);
  }

  async updatePurchaseRequest(tenantId: string, userId: string, id: string, dto: UpdateInventoryPurchaseRequestDto) {
    const before = await this.getPurchaseRequest(tenantId, id);
    if (before.status !== 'DRAFT') throw new BadRequestException('Only DRAFT purchase requests can be edited');
    const row = await this.db.$transaction(async (tx) => {
      await tx.inventoryPurchaseRequestItem.deleteMany({ where: { requestId: id } });
      const updated = await tx.inventoryPurchaseRequest.update({
        where: { id },
        data: {
          requestedBy: dto.requestedBy,
          departmentId: dto.departmentId,
          vendorId: dto.vendorId,
          requiresApproval: dto.requiresApproval,
          notes: dto.notes,
          updatedBy: userId,
        },
      });
      for (const item of dto.items ?? []) {
        await tx.inventoryPurchaseRequestItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            request: { connect: { id } },
            product: { connect: { id: item.productId } },
            quantityRequested: item.quantityRequested,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_UPDATED, 'InventoryPurchaseRequest', id, { before });
      return updated;
    });
    return this.getPurchaseRequest(tenantId, row.id);
  }

  async submitPurchaseRequest(tenantId: string, userId: string, id: string) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Purchase request not found');
    if (row.status !== 'DRAFT') throw new BadRequestException(`Cannot submit a request in state ${row.status}`);
    const updated = await this.db.inventoryPurchaseRequest.update({ where: { id }, data: { status: 'PENDING_APPROVAL', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_SUBMITTED, 'InventoryPurchaseRequest', id, { before: row, after: updated });
    return updated;
  }

  async approvePurchaseRequest(tenantId: string, userId: string, id: string) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Purchase request not found');
    if (row.status !== 'PENDING_APPROVAL') throw new BadRequestException(`Cannot approve a request in state ${row.status}`);
    const updated = await this.db.$transaction(async (tx) => {
      const approved = await tx.inventoryPurchaseRequest.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), reviewedById: userId, updatedBy: userId },
      });
      const items = await tx.inventoryPurchaseRequestItem.findMany({ where: { requestId: id }, select: { id: true, quantityRequested: true } });
      for (const item of items) {
        await tx.inventoryPurchaseRequestItem.update({ where: { id: item.id }, data: { quantityApproved: item.quantityRequested } });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_APPROVED, 'InventoryPurchaseRequest', id, { before: row, after: approved });
      return approved;
    });
    return updated;
  }

  async rejectPurchaseRequest(tenantId: string, userId: string, id: string, dto: RejectInventoryPurchaseRequestDto) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Purchase request not found');
    if (row.status !== 'PENDING_APPROVAL') throw new BadRequestException(`Cannot reject a request in state ${row.status}`);
    const updated = await this.db.inventoryPurchaseRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: userId, rejectionReason: dto.reason, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_REJECTED, 'InventoryPurchaseRequest', id, { before: row, after: updated });
    return updated;
  }

  async cancelPurchaseRequest(tenantId: string, userId: string, id: string) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Purchase request not found');
    if (!['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(row.status)) throw new BadRequestException(`Cannot cancel a request in state ${row.status}`);
    const updated = await this.db.inventoryPurchaseRequest.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_CANCELLED, 'InventoryPurchaseRequest', id, { before: row, after: updated });
    return updated;
  }

  async deletePurchaseRequest(tenantId: string, userId: string, id: string) {
    const row = await this.db.inventoryPurchaseRequest.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Purchase request not found');
    if (row.status !== 'DRAFT') throw new BadRequestException('Only DRAFT purchase requests can be deleted');
    await this.db.$transaction(async (tx) => {
      await tx.inventoryPurchaseRequestItem.deleteMany({ where: { requestId: id } });
      await tx.inventoryPurchaseRequest.delete({ where: { id } });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_REQUEST_DELETED, 'InventoryPurchaseRequest', id);
    return { id, deleted: true };
  }

  // ── Purchase orders ───────────────────────────────────────────────────────

  async listPurchaseOrders(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = {};
    if (page.search) where.OR = [{ poNumber: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryPurchaseOrder, where, { createdAt: 'desc' }, page.skip ?? 0, page.take ?? 50, {
      vendor: { select: { id: true, name: true, code: true } },
      purchaseRequest: { select: { id: true, requestNumber: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
      _count: { select: { goodsReceipts: true } },
    });
  }

  async getPurchaseOrder(tenantId: string, id: string) {
    const row = await this.db.inventoryPurchaseOrder.findFirst({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
        items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
        goodsReceipts: { select: { id: true, grnNumber: true, status: true, receivedAt: true } },
      },
    });
    if (!row) throw new NotFoundException('Purchase order not found');
    return row;
  }

  async createPurchaseOrder(tenantId: string, userId: string, dto: CreateInventoryPurchaseOrderDto) {
    const row = await this.db.$transaction(async (tx) => {
      const poNumber = await this.nextNumber(tx, tenantId, 'PURCHASE_ORDER', 'PO');
      const totalCents = dto.items.reduce((sum, item) => sum + (item.quantityOrdered * (item.unitPriceCents ?? 0)), 0);
      const po = await tx.inventoryPurchaseOrder.create({
        data: {
          tenant: { connect: { id: tenantId } },
          poNumber,
          vendor: { connect: { id: dto.vendorId } },
          orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          totalCents,
          notes: dto.notes,
          createdBy: userId,
        },
      });
      for (const item of dto.items) {
        await tx.inventoryPurchaseOrderItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            po: { connect: { id: po.id } },
            product: { connect: { id: item.productId } },
            quantityOrdered: item.quantityOrdered,
            unitPriceCents: item.unitPriceCents ?? 0,
            notes: item.notes,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_ORDER_CREATED, 'InventoryPurchaseOrder', po.id);
      return po;
    });
    return this.getPurchaseOrder(tenantId, row.id);
  }

  async createPurchaseOrderFromRequest(tenantId: string, userId: string, requestId: string) {
    const request = await this.getPurchaseRequest(tenantId, requestId);
    if (request.status !== 'APPROVED') throw new BadRequestException('Only an APPROVED purchase request can be converted');
    if (request.purchaseOrder) throw new ConflictException('Purchase request is already converted');
    if (!request.vendorId) throw new BadRequestException('Purchase request must have a vendor before conversion');
    const vendorId: string = request.vendorId;
    const row = await this.db.$transaction(async (tx) => {
      const poNumber = await this.nextNumber(tx, tenantId, 'PURCHASE_ORDER', 'PO');
      const totalCents = request.items.reduce((sum, item) => sum + (item.quantityApproved ?? item.quantityRequested) * (item.unitPriceCents ?? 0), 0);
      const po = await tx.inventoryPurchaseOrder.create({
        data: {
          tenant: { connect: { id: tenantId } },
          poNumber,
          vendor: { connect: { id: vendorId } },
          purchaseRequest: { connect: { id: requestId } },
          totalCents,
          createdBy: userId,
        },
      });
      for (const item of request.items) {
        await tx.inventoryPurchaseOrderItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            po: { connect: { id: po.id } },
            product: { connect: { id: item.productId } },
            quantityOrdered: item.quantityApproved ?? item.quantityRequested,
            unitPriceCents: item.unitPriceCents ?? 0,
            notes: item.notes,
          },
        });
      }
      await tx.inventoryPurchaseRequest.update({ where: { id: requestId }, data: { status: 'CONVERTED', updatedBy: userId } });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_ORDER_FROM_REQUEST, 'InventoryPurchaseOrder', po.id, { before: request });
      return po;
    });
    return this.getPurchaseOrder(tenantId, row.id);
  }

  async updatePurchaseOrder(tenantId: string, userId: string, id: string, dto: UpdateInventoryPurchaseOrderDto) {
    const before = await this.getPurchaseOrder(tenantId, id);
    if (before.status !== 'DRAFT') throw new BadRequestException('Only DRAFT purchase orders can be edited');
    const row = await this.db.$transaction(async (tx) => {
      await tx.inventoryPurchaseOrderItem.deleteMany({ where: { poId: id } });
      const totalCents = (dto.items ?? before.items).reduce((sum: number, item: any) => sum + item.quantityOrdered * (item.unitPriceCents ?? 0), 0);
      const po = await tx.inventoryPurchaseOrder.update({
        where: { id },
        data: { vendorId: dto.vendorId, orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined, expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined, notes: dto.notes, totalCents, updatedBy: userId },
      });
      for (const item of dto.items ?? []) {
        await tx.inventoryPurchaseOrderItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            po: { connect: { id } },
            product: { connect: { id: item.productId } },
            quantityOrdered: item.quantityOrdered,
            unitPriceCents: item.unitPriceCents ?? 0,
            notes: item.notes,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_ORDER_UPDATED, 'InventoryPurchaseOrder', id, { before });
      return po;
    });
    return this.getPurchaseOrder(tenantId, row.id);
  }

  async issuePurchaseOrder(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryPurchaseOrder.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Purchase order not found');
    if (before.status !== 'DRAFT') throw new BadRequestException(`Cannot issue a PO in state ${before.status}`);
    const updated = await this.db.inventoryPurchaseOrder.update({
      where: { id },
      data: { status: 'ISSUED', approvedById: userId, approvedAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_ORDER_ISSUED, 'InventoryPurchaseOrder', id, { before, after: updated });
    return updated;
  }

  async cancelPurchaseOrder(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryPurchaseOrder.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Purchase order not found');
    if (!['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(before.status)) throw new BadRequestException(`Cannot cancel a PO in state ${before.status}`);
    const updated = await this.db.inventoryPurchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_PURCHASE_ORDER_CANCELLED, 'InventoryPurchaseOrder', id, { before, after: updated });
    return updated;
  }

  // ── Goods receipts ────────────────────────────────────────────────────────

  async listGoodsReceipts(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = {};
    if (page.search) where.OR = [{ grnNumber: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryGoodsReceipt, where, { createdAt: 'desc' }, page.skip ?? 0, page.take ?? 50, {
      vendor: { select: { id: true, name: true } },
      po: { select: { id: true, poNumber: true } },
      _count: { select: { items: true } },
    });
  }

  async getGoodsReceipt(tenantId: string, id: string) {
    const row = await this.db.inventoryGoodsReceipt.findFirst({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true, code: true } },
        po: { select: { id: true, poNumber: true, status: true } },
        items: {
          include: {
            product: { select: { id: true, code: true, name: true, unit: true } },
            location: { select: { id: true, code: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Goods receipt not found');
    return row;
  }

  async createGoodsReceipt(tenantId: string, userId: string, dto: CreateInventoryGoodsReceiptDto) {
    if (dto.poId) {
      for (const item of dto.items) {
        if (!item.poItemId) throw new BadRequestException('Items must reference purchase order lines when the receipt is linked to a PO');
      }
    }
    const row = await this.db.$transaction(async (tx) => {
      const grnNumber = await this.nextNumber(tx, tenantId, 'GOODS_RECEIPT', 'GRN');
      const data: any = {
        tenant: { connect: { id: tenantId } },
        grnNumber,
        vendor: { connect: { id: dto.vendorId } },
        poId: dto.poId,
        receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
        notes: dto.notes,
        createdBy: userId,
      };
      const grn = await tx.inventoryGoodsReceipt.create({ data });
      for (const item of dto.items) {
        const itemData: any = {
          tenant: { connect: { id: tenantId } },
          grn: { connect: { id: grn.id } },
          poItemId: item.poItemId,
          product: { connect: { id: item.productId } },
          location: { connect: { id: item.locationId } },
          quantityReceived: item.quantityReceived,
          unitPriceCents: item.unitPriceCents ?? 0,
          notes: item.notes,
        };
        await tx.inventoryGoodsReceiptItem.create({ data: itemData });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_GOODS_RECEIPT_CREATED, 'InventoryGoodsReceipt', grn.id);
      return grn;
    });
    return this.getGoodsReceipt(tenantId, row.id);
  }

  async completeGoodsReceipt(tenantId: string, userId: string, id: string) {
    const grn = await this.db.inventoryGoodsReceipt.findFirst({
      where: { id },
      include: { items: { select: { id: true, poItemId: true, productId: true, locationId: true, quantityReceived: true } } },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');
    if (grn.status !== 'DRAFT') throw new BadRequestException(`Cannot complete a receipt in state ${grn.status}`);

    const result = await this.db.$transaction(async (tx) => {
      const poItems = grn.poId
        ? await tx.inventoryPurchaseOrderItem.findMany({ where: { poId: grn.poId }, select: { id: true, quantityOrdered: true, quantityReceived: true } })
        : [];
      const poItemById = new Map(poItems.map((p: any) => [p.id, p]));
      for (const item of grn.items) {
        if (item.poItemId) {
          const poItem = poItemById.get(item.poItemId);
          if (!poItem) throw new BadRequestException('Receipt references an unknown purchase order line');
          if (poItem.quantityReceived + item.quantityReceived > poItem.quantityOrdered) {
            throw new BadRequestException('Received quantity exceeds the ordered quantity on a purchase order line');
          }
        }
        const type: any = 'RECEIPT';
        await this.applyMovement(tx, tenantId, userId, {
          productId: item.productId,
          locationId: item.locationId,
          type,
          quantityDelta: item.quantityReceived,
          reason: 'Goods receipt',
          referenceType: 'GOODS_RECEIPT',
          referenceId: grn.id,
          notes: `GRN ${grn.grnNumber}`,
          occurredAt: new Date(),
        });
        if (item.poItemId) {
          await tx.inventoryPurchaseOrderItem.update({
            where: { id: item.poItemId },
            data: { quantityReceived: { increment: item.quantityReceived } },
          });
        }
      }
      let poStatus: string | undefined;
      if (grn.poId) {
        const all = await tx.inventoryPurchaseOrderItem.findMany({ where: { poId: grn.poId }, select: { quantityOrdered: true, quantityReceived: true } });
        const fullyReceived = all.every((p: any) => p.quantityReceived >= p.quantityOrdered);
        const anyReceived = all.some((p: any) => p.quantityReceived > 0);
        poStatus = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'ISSUED';
        await tx.inventoryPurchaseOrder.update({ where: { id: grn.poId }, data: { status: poStatus as any, receivedAt: new Date(), updatedBy: userId } });
      }
      const completed = await tx.inventoryGoodsReceipt.update({
        where: { id },
        data: { status: 'COMPLETED', receivedBy: userId, receivedAt: new Date(), updatedBy: userId },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_GOODS_RECEIPT_COMPLETED, 'InventoryGoodsReceipt', id, { before: grn, after: completed });
      return { completed, poStatus };
    });
    return result;
  }

  async cancelGoodsReceipt(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryGoodsReceipt.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Goods receipt not found');
    if (before.status !== 'DRAFT') throw new BadRequestException(`Cannot cancel a receipt in state ${before.status}`);
    const updated = await this.db.inventoryGoodsReceipt.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_GOODS_RECEIPT_CANCELLED, 'InventoryGoodsReceipt', id, { before, after: updated });
    return updated;
  }

  // ── Stock transfers ───────────────────────────────────────────────────────

  async listStockTransfers(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = {};
    if (page.search) where.OR = [{ transferNumber: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryStockTransfer, where, { createdAt: 'desc' }, page.skip ?? 0, page.take ?? 50, {
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
    });
  }

  async getStockTransfer(tenantId: string, id: string) {
    const row = await this.db.inventoryStockTransfer.findFirst({
      where: { id },
      include: {
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Stock transfer not found');
    return row;
  }

  async createStockTransfer(tenantId: string, userId: string, dto: CreateInventoryStockTransferDto) {
    if (dto.fromLocationId === dto.toLocationId) throw new BadRequestException('Source and destination locations must differ');
    const row = await this.db.$transaction(async (tx) => {
      const transferNumber = await this.nextNumber(tx, tenantId, 'STOCK_TRANSFER', 'ST');
      const transfer = await tx.inventoryStockTransfer.create({
        data: {
          tenant: { connect: { id: tenantId } },
          transferNumber,
          fromLocation: { connect: { id: dto.fromLocationId } },
          toLocation: { connect: { id: dto.toLocationId } },
          requestedBy: userId,
          notes: dto.notes,
          createdBy: userId,
        },
      });
      for (const item of dto.items) {
        await tx.inventoryStockTransferItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            transfer: { connect: { id: transfer.id } },
            product: { connect: { id: item.productId } },
            quantity: item.quantity,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_TRANSFER_CREATED, 'InventoryStockTransfer', transfer.id);
      return transfer;
    });
    return this.getStockTransfer(tenantId, row.id);
  }

  async completeStockTransfer(tenantId: string, userId: string, id: string) {
    const transfer = await this.db.inventoryStockTransfer.findFirst({
      where: { id },
      include: { items: { select: { id: true, productId: true, quantity: true } } },
    });
    if (!transfer) throw new NotFoundException('Stock transfer not found');
    if (transfer.status !== 'PENDING') throw new BadRequestException(`Cannot complete a transfer in state ${transfer.status}`);
    const result = await this.db.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const available = await tx.inventoryStockItem.findFirst({ where: { tenantId, productId: item.productId, locationId: transfer.fromLocationId }, select: { quantityOnHand: true } });
        if ((available?.quantityOnHand ?? 0) < item.quantity) {
          throw new BadRequestException('Insufficient stock at the source location');
        }
      }
      for (const item of transfer.items) {
        await this.applyMovement(tx, tenantId, userId, {
          productId: item.productId,
          locationId: transfer.fromLocationId,
          type: 'TRANSFER_OUT',
          quantityDelta: -item.quantity,
          reason: 'Stock transfer',
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          notes: `To ${transfer.transferNumber}`,
        });
        await this.applyMovement(tx, tenantId, userId, {
          productId: item.productId,
          locationId: transfer.toLocationId,
          type: 'TRANSFER_IN',
          quantityDelta: item.quantity,
          reason: 'Stock transfer',
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          notes: `From ${transfer.transferNumber}`,
        });
      }
      const completed = await tx.inventoryStockTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', completedBy: userId, completedAt: new Date(), updatedBy: userId },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_TRANSFER_COMPLETED, 'InventoryStockTransfer', id, { before: transfer, after: completed });
      return completed;
    });
    return result;
  }

  async cancelStockTransfer(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryStockTransfer.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Stock transfer not found');
    if (before.status !== 'PENDING') throw new BadRequestException(`Cannot cancel a transfer in state ${before.status}`);
    const updated = await this.db.inventoryStockTransfer.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_TRANSFER_CANCELLED, 'InventoryStockTransfer', id, { before, after: updated });
    return updated;
  }

  // ── Stock adjustments ─────────────────────────────────────────────────────

  async listStockAdjustments(tenantId: string, page: { skip?: number; take?: number; search?: string }) {
    const where: any = {};
    if (page.search) where.OR = [{ adjustmentNumber: { contains: page.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryStockAdjustment, where, { createdAt: 'desc' }, page.skip ?? 0, page.take ?? 50, {
      location: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
    });
  }

  async getStockAdjustment(tenantId: string, id: string) {
    const row = await this.db.inventoryStockAdjustment.findFirst({
      where: { id },
      include: {
        location: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Stock adjustment not found');
    return row;
  }

  async createStockAdjustment(tenantId: string, userId: string, dto: CreateInventoryStockAdjustmentDto) {
    const row = await this.db.$transaction(async (tx) => {
      const adjustmentNumber = await this.nextNumber(tx, tenantId, 'STOCK_ADJUSTMENT', 'SA');
      const adjustment = await tx.inventoryStockAdjustment.create({
        data: {
          tenant: { connect: { id: tenantId } },
          adjustmentNumber,
          location: { connect: { id: dto.locationId } },
          reason: dto.reason,
          description: dto.description,
          createdBy: userId,
        },
      });
      for (const item of dto.items) {
        await tx.inventoryStockAdjustmentItem.create({
          data: {
            tenant: { connect: { id: tenantId } },
            adjustment: { connect: { id: adjustment.id } },
            product: { connect: { id: item.productId } },
            quantityDelta: item.quantityDelta,
            reason: item.reason,
          },
        });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_ADJUSTMENT_CREATED, 'InventoryStockAdjustment', adjustment.id);
      return adjustment;
    });
    return this.getStockAdjustment(tenantId, row.id);
  }

  async completeStockAdjustment(tenantId: string, userId: string, id: string) {
    const adjustment = await this.db.inventoryStockAdjustment.findFirst({
      where: { id },
      include: { items: { select: { id: true, productId: true, quantityDelta: true, reason: true } } },
    });
    if (!adjustment) throw new NotFoundException('Stock adjustment not found');
    if (adjustment.status !== 'DRAFT') throw new BadRequestException(`Cannot complete an adjustment in state ${adjustment.status}`);
    const result = await this.db.$transaction(async (tx) => {
      for (const item of adjustment.items) {
        if (item.quantityDelta === 0) continue;
        await this.applyMovement(tx, tenantId, userId, {
          productId: item.productId,
          locationId: adjustment.locationId,
          type: item.quantityDelta > 0 ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_SUBTRACT',
          quantityDelta: item.quantityDelta,
          reason: item.reason ?? adjustment.reason ?? 'Stock adjustment',
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: adjustment.id,
          notes: adjustment.description ?? undefined,
        });
      }
      const completed = await tx.inventoryStockAdjustment.update({
        where: { id },
        data: { status: 'COMPLETED', adjustedBy: userId, adjustedAt: new Date(), updatedBy: userId },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_ADJUSTMENT_COMPLETED, 'InventoryStockAdjustment', id, { before: adjustment, after: completed });
      return completed;
    });
    return result;
  }

  async cancelStockAdjustment(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryStockAdjustment.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Stock adjustment not found');
    if (before.status !== 'DRAFT') throw new BadRequestException(`Cannot cancel an adjustment in state ${before.status}`);
    const updated = await this.db.inventoryStockAdjustment.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_STOCK_ADJUSTMENT_CANCELLED, 'InventoryStockAdjustment', id, { before, after: updated });
    return updated;
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  async listAssets(tenantId: string, q: ListAssetsDto) {
    const where: any = { deletedAt: null };
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.status) where.status = q.status;
    if (q.locationId) where.locationId = q.locationId;
    if (q.assignedOnly) where.status = 'ASSIGNED';
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { assetCode: { contains: q.search, mode: 'insensitive' } }, { tagNumber: { contains: q.search, mode: 'insensitive' } }, { serialNumber: { contains: q.search, mode: 'insensitive' } }];
    return this.page(this.db.inventoryAsset, where, { createdAt: 'desc' }, q.skip ?? 0, q.take ?? 50, {
      category: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      assignments: { where: { status: 'ACTIVE' }, take: 1, orderBy: { assignedAt: 'desc' }, include: { employee: { select: { id: true, firstName: true, lastName: true } }, department: { select: { id: true, name: true } }, campus: { select: { id: true, name: true } } } },
    });
  }

  async getAsset(tenantId: string, id: string) {
    const row = await this.db.inventoryAsset.findFirst({
      where: { id },
      include: {
        category: { select: { id: true, code: true, name: true, kind: true } },
        location: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        assignments: { orderBy: { assignedAt: 'desc' }, include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } }, department: { select: { id: true, name: true } }, campus: { select: { id: true, name: true } } } },
        maintenanceRecords: { orderBy: { scheduledDate: 'desc' }, take: 20 },
        warrantyClaims: { orderBy: { openedAt: 'desc' }, take: 20 },
        depreciationEntries: { orderBy: { periodStart: 'desc' }, take: 60 },
        disposals: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Asset not found');
    return row;
  }

  async createAsset(tenantId: string, userId: string, dto: CreateInventoryAssetDto) {
    const category = await this.db.inventoryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null, kind: 'ASSET' } });
    if (!category) throw new BadRequestException('Valid asset category is required');
    const row = await this.db.$transaction(async (tx) => {
      const assetCode = dto.assetCode ?? (await this.nextNumber(tx, tenantId, 'ASSET', 'AST'));
      const tagNumber = dto.tagNumber ?? (await this.nextNumber(tx, tenantId, 'ASSET_TAG', 'TAG'));
      const data: any = {
        tenant: { connect: { id: tenantId } },
        assetCode,
        tagNumber,
        name: dto.name,
        description: dto.description,
        category: { connect: { id: dto.categoryId } },
        vendorId: dto.vendorId,
        locationId: dto.locationId,
        serialNumber: dto.serialNumber,
        brand: dto.brand,
        modelName: dto.modelName,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
        purchaseCostCents: dto.purchaseCostCents,
        warrantyStartDate: dto.warrantyStartDate ? new Date(dto.warrantyStartDate) : null,
        warrantyEndDate: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : null,
        warrantyProvider: dto.warrantyProvider,
        status: 'IN_STOCK',
        condition: dto.condition ?? 'NEW',
        depreciationMethod: dto.depreciationMethod ?? 'NONE',
        usefulLifeMonths: dto.usefulLifeMonths,
        salvageValueCents: dto.salvageValueCents ?? 0,
        currentBookValueCents: dto.purchaseCostCents,
        notes: dto.notes,
        createdBy: userId,
      };
      const asset = await tx.inventoryAsset.create({ data });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_CREATED, 'InventoryAsset', asset.id);
      return asset;
    });
    return this.getAsset(tenantId, row.id);
  }

  async updateAsset(tenantId: string, userId: string, id: string, dto: UpdateInventoryAssetDto) {
    const before = await this.db.inventoryAsset.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Asset not found');
    if (before.status === 'DISPOSED') throw new BadRequestException('Disposed assets cannot be edited');
    if (dto.categoryId) {
      const category = await this.db.inventoryCategory.findFirst({ where: { id: dto.categoryId, deletedAt: null, kind: 'ASSET' } });
      if (!category) throw new BadRequestException('Valid asset category is required');
    }
    const entries = await this.db.inventoryAssetDepreciationEntry.count({ where: { assetId: id } });
    const data: any = {
      assetCode: dto.assetCode,
      tagNumber: dto.tagNumber,
      name: dto.name,
      description: dto.description,
      categoryId: dto.categoryId,
      vendorId: dto.vendorId,
      locationId: dto.locationId,
      serialNumber: dto.serialNumber,
      brand: dto.brand,
      modelName: dto.modelName,
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
      purchaseCostCents: dto.purchaseCostCents,
      warrantyStartDate: dto.warrantyStartDate ? new Date(dto.warrantyStartDate) : undefined,
      warrantyEndDate: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : undefined,
      warrantyProvider: dto.warrantyProvider,
      condition: dto.condition as any,
      depreciationMethod: dto.depreciationMethod as any,
      usefulLifeMonths: dto.usefulLifeMonths,
      salvageValueCents: dto.salvageValueCents,
      currentBookValueCents: entries === 0 && dto.purchaseCostCents !== undefined ? dto.purchaseCostCents : undefined,
      notes: dto.notes,
      updatedBy: userId,
    };
    const row = await this.db.inventoryAsset.update({
      where: { id },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_UPDATED, 'InventoryAsset', id, { before, after: row });
    return this.getAsset(tenantId, row.id);
  }

  async deleteAsset(tenantId: string, userId: string, id: string) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    const active = await this.db.inventoryAssetAssignment.count({ where: { assetId: id, status: 'ACTIVE' } });
    if (active > 0) throw new ConflictException('Asset has an active assignment — return it first');
    const row = await this.db.inventoryAsset.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_DELETED, 'InventoryAsset', id);
    return row;
  }

  async assignAsset(tenantId: string, userId: string, id: string, dto: AssignAssetDto) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (NON_ASSIGNABLE_ASSET_STATUSES.includes(asset.status)) throw new BadRequestException(`Asset cannot be assigned while ${asset.status}`);
    const row = await this.db.$transaction(async (tx) => {
      await tx.inventoryAssetAssignment.updateMany({
        where: { assetId: id, status: 'ACTIVE' },
        data: { status: 'RETURNED', returnedAt: new Date() },
      });
      const assignmentData: any = {
        tenant: { connect: { id: tenantId } },
        asset: { connect: { id } },
        assigneeType: dto.assigneeType,
        employeeId: dto.employeeId,
        departmentId: dto.departmentId,
        campusId: dto.campusId,
        assigneeName: dto.assigneeName,
        assignedBy: userId,
        notes: dto.notes,
      };
      const assignment = await tx.inventoryAssetAssignment.create({ data: assignmentData });
      const updated = await tx.inventoryAsset.update({ where: { id }, data: { status: 'ASSIGNED', updatedBy: userId } });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_ASSIGNED, 'InventoryAsset', id, { before: asset, after: updated });
      return assignment;
    });
    return this.getAsset(tenantId, row.assetId);
  }

  async returnAsset(tenantId: string, userId: string, id: string, dto: ReturnAssetDto) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    const row = await this.db.$transaction(async (tx) => {
      await tx.inventoryAssetAssignment.updateMany({
        where: { assetId: id, status: 'ACTIVE' },
        data: { status: 'RETURNED', returnedAt: new Date(), notes: dto.notes },
      });
      const status = await this.restoreAssetStatus(tx, id);
      const updated = await tx.inventoryAsset.update({ where: { id }, data: { status, updatedBy: userId } });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_RETURNED, 'InventoryAsset', id, { before: asset, after: updated });
      return updated;
    });
    return this.getAsset(tenantId, row.id);
  }

  // ── Asset maintenance ─────────────────────────────────────────────────────

  async listMaintenanceRecords(tenantId: string, q: { skip?: number; take?: number; search?: string; status?: string; assetId?: string }) {
    const where: any = {};
    if (q.assetId) where.assetId = q.assetId;
    if (q.status) where.status = q.status;
    return this.page(this.db.inventoryAssetMaintenance, where, { scheduledDate: 'desc' }, q.skip ?? 0, q.take ?? 50, {
      asset: { select: { id: true, assetCode: true, name: true } },
      vendor: { select: { id: true, name: true } },
    });
  }

  async createMaintenance(tenantId: string, userId: string, assetId: string, dto: CreateInventoryMaintenanceDto) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (NON_ASSIGNABLE_ASSET_STATUSES.includes(asset.status)) throw new BadRequestException(`Asset cannot have maintenance while ${asset.status}`);
    const row = await this.db.$transaction(async (tx) => {
      const maintenanceNumber = await this.nextNumber(tx, tenantId, 'MAINTENANCE', 'MNT');
      const status = (dto.status as any) ?? 'SCHEDULED';
      const recordData: any = {
        tenant: { connect: { id: tenantId } },
        asset: { connect: { id: assetId } },
        maintenanceNumber,
        vendorId: dto.vendorId,
        type: dto.type ?? 'PREVENTIVE',
        status,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : status === 'IN_PROGRESS' ? new Date() : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : status === 'COMPLETED' ? new Date() : undefined,
        description: dto.description,
        costCents: dto.costCents,
        performedBy: dto.performedBy,
        notes: dto.notes,
        createdBy: userId,
      };
      const record = await tx.inventoryAssetMaintenance.create({ data: recordData });
      if (status === 'IN_PROGRESS') {
        await tx.inventoryAsset.update({ where: { id: assetId }, data: { status: 'UNDER_MAINTENANCE', updatedBy: userId } });
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_MAINTENANCE_CREATED, 'InventoryAssetMaintenance', record.id);
      return record;
    });
    return row;
  }

  async updateMaintenance(tenantId: string, userId: string, id: string, dto: UpdateInventoryMaintenanceDto) {
    const record = await this.db.inventoryAssetMaintenance.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Maintenance record not found');
    if (['COMPLETED', 'CANCELLED'].includes(record.status)) throw new BadRequestException('Completed or cancelled maintenance records are immutable');
    const row = await this.db.inventoryAssetMaintenance.update({
      where: { id },
      data: {
        vendorId: dto.vendorId,
        type: dto.type as any,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
        description: dto.description,
        costCents: dto.costCents,
        performedBy: dto.performedBy,
        notes: dto.notes,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_MAINTENANCE_UPDATED, 'InventoryAssetMaintenance', id, { before: record, after: row });
    return row;
  }

  async setMaintenanceStatus(tenantId: string, userId: string, id: string, dto: SetInventoryMaintenanceStatusDto) {
    const record = await this.db.inventoryAssetMaintenance.findFirst({ where: { id } });
    if (!record) throw new NotFoundException('Maintenance record not found');
    const result = await this.db.$transaction(async (tx) => {
      let updated: any;
      if (dto.status === 'IN_PROGRESS') {
        if (record.status !== 'SCHEDULED') throw new BadRequestException(`Cannot move maintenance from ${record.status} to IN_PROGRESS`);
        updated = await tx.inventoryAssetMaintenance.update({
          where: { id },
          data: { status: 'IN_PROGRESS', startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(), updatedBy: userId },
        });
        await tx.inventoryAsset.update({ where: { id: record.assetId }, data: { status: 'UNDER_MAINTENANCE', updatedBy: userId } });
      } else if (dto.status === 'COMPLETED') {
        if (record.status !== 'IN_PROGRESS') throw new BadRequestException(`Cannot move maintenance from ${record.status} to COMPLETED`);
        updated = await tx.inventoryAssetMaintenance.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date(), updatedBy: userId },
        });
        await this.restoreAssetStatus(tx, record.assetId);
      } else if (dto.status === 'CANCELLED') {
        if (['COMPLETED', 'CANCELLED'].includes(record.status)) throw new BadRequestException('Maintenance is already closed');
        updated = await tx.inventoryAssetMaintenance.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
        await this.restoreAssetStatus(tx, record.assetId);
      } else {
        throw new BadRequestException(`Unsupported maintenance status ${dto.status}`);
      }
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_MAINTENANCE_STATUS_CHANGED, 'InventoryAssetMaintenance', id, { before: record, after: updated });
      return updated;
    });
    return result;
  }

  // ── Warranty claims ───────────────────────────────────────────────────────

  async listWarrantyClaims(tenantId: string, q: { skip?: number; take?: number; search?: string; status?: string; assetId?: string }) {
    const where: any = {};
    if (q.assetId) where.assetId = q.assetId;
    if (q.status) where.status = q.status;
    return this.page(this.db.inventoryAssetWarrantyClaim, where, { openedAt: 'desc' }, q.skip ?? 0, q.take ?? 50, {
      asset: { select: { id: true, assetCode: true, name: true } },
    });
  }

  async createWarrantyClaim(tenantId: string, userId: string, assetId: string, dto: CreateWarrantyClaimDto) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    const row = await this.db.$transaction(async (tx) => {
      const claimNumber = await this.nextNumber(tx, tenantId, 'WARRANTY_CLAIM', 'WRN');
      const claim = await tx.inventoryAssetWarrantyClaim.create({
        data: {
          tenant: { connect: { id: tenantId } },
          asset: { connect: { id: assetId } },
          claimNumber,
          description: dto.description,
          costCents: dto.costCents ?? 0,
          notes: dto.notes,
          createdBy: userId,
        },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_WARRANTY_CLAIM_CREATED, 'InventoryAssetWarrantyClaim', claim.id);
      return claim;
    });
    return row;
  }

  async updateWarrantyClaim(tenantId: string, userId: string, id: string, dto: UpdateWarrantyClaimDto) {
    const claim = await this.db.inventoryAssetWarrantyClaim.findFirst({ where: { id } });
    if (!claim) throw new NotFoundException('Warranty claim not found');
    if (['REPAIRED', 'REJECTED', 'CLOSED'].includes(claim.status)) throw new BadRequestException('Closed warranty claims are immutable');
    const row = await this.db.inventoryAssetWarrantyClaim.update({
      where: { id },
      data: { description: dto.description, costCents: dto.costCents, resolution: dto.resolution, notes: dto.notes, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_WARRANTY_CLAIM_UPDATED, 'InventoryAssetWarrantyClaim', id, { before: claim, after: row });
    return row;
  }

  async setWarrantyClaimStatus(tenantId: string, userId: string, id: string, dto: SetWarrantyClaimStatusDto) {
    const claim = await this.db.inventoryAssetWarrantyClaim.findFirst({ where: { id } });
    if (!claim) throw new NotFoundException('Warranty claim not found');
    const closed = dto.status === 'CLOSED';
    if (closed && !dto.resolution) {
      const row = await this.db.inventoryAssetWarrantyClaim.update({
        where: { id },
        data: { status: dto.status as any, closedAt: new Date(), updatedBy: userId },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_WARRANTY_CLAIM_STATUS_CHANGED, 'InventoryAssetWarrantyClaim', id, { before: claim, after: row });
      return row;
    }
    const row = await this.db.inventoryAssetWarrantyClaim.update({
      where: { id },
      data: { status: dto.status as any, resolution: dto.resolution, closedAt: closed ? new Date() : undefined, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_WARRANTY_CLAIM_STATUS_CHANGED, 'InventoryAssetWarrantyClaim', id, { before: claim, after: row });
    return row;
  }

  // ── Depreciation ──────────────────────────────────────────────────────────

  async listDepreciationEntries(tenantId: string, assetId: string) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return this.db.inventoryAssetDepreciationEntry.findMany({
      where: { assetId },
      orderBy: { periodStart: 'asc' },
    });
  }

  async runDepreciation(tenantId: string, userId: string, dto: RunDepreciationDto) {
    const asOf = dto.asOfDate ? new Date(dto.asOfDate) : new Date();
    const target = monthStart(asOf);
    const where: any = {
      deletedAt: null,
      depreciationMethod: 'STRAIGHT_LINE',
      usefulLifeMonths: { not: null },
      purchaseDate: { not: null },
      purchaseCostCents: { not: null },
      status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] },
    };
    if (dto.assetId) where.id = dto.assetId;
    const assets = await this.db.inventoryAsset.findMany({
      where,
      select: { id: true, assetCode: true, name: true, purchaseDate: true, purchaseCostCents: true, salvageValueCents: true, usefulLifeMonths: true },
    });
    const result: any[] = [];
    let entriesCreated = 0;
    for (const asset of assets as any[]) {
      const cost = asset.purchaseCostCents;
      const salvage = asset.salvageValueCents;
      const life = asset.usefulLifeMonths;
      const monthly = Math.floor((cost - salvage) / life);
      if (monthly <= 0) continue;
      const anchor = addMonths(monthStart(asset.purchaseDate), 1);
      if (target < anchor) continue;
      const last = await this.db.inventoryAssetDepreciationEntry.findFirst({
        where: { assetId: asset.id },
        orderBy: { periodStart: 'desc' },
      });
      const start = last ? addMonths(monthStart(last.periodStart), 1) : anchor;
      if (start > target) continue;
      let opening = last ? last.closingBookValueCents : cost;
      const generated: string[] = [];
      for (let period = new Date(start); period <= target; period = addMonths(period, 1)) {
        const remaining = opening - salvage;
        if (remaining <= 0) break;
        const depreciation = Math.min(monthly, remaining);
        const closing = opening - depreciation;
        const existing = await this.db.inventoryAssetDepreciationEntry.findFirst({
          where: { assetId: asset.id, periodStart: period },
          select: { id: true },
        });
        if (existing) {
          opening = closing;
          continue;
        }
        const entry = await this.db.inventoryAssetDepreciationEntry.create({
          data: {
            tenant: { connect: { id: tenantId } },
            asset: { connect: { id: asset.id } },
            periodStart: period,
            periodEnd: monthEnd(period),
            method: 'STRAIGHT_LINE',
            openingBookValueCents: opening,
            depreciationCents: depreciation,
            closingBookValueCents: closing,
          },
        });
        await this.db.inventoryAsset.update({ where: { id: asset.id }, data: { currentBookValueCents: closing, updatedBy: userId } });
        entriesCreated += 1;
        opening = closing;
        generated.push(entry.periodStart.toISOString());
      }
      if (generated.length > 0) {
        result.push({ assetId: asset.id, assetCode: asset.assetCode, name: asset.name, periods: generated, bookValueCents: opening });
      }
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_DEPRECIATION_RUN, 'InventoryAssetDepreciationEntry', dto.assetId, {
      after: { asOf: asOf.toISOString(), entriesCreated, assets: result.length },
    });
    return { asOf: asOf.toISOString(), entriesCreated, summary: result };
  }

  // ── Disposals ─────────────────────────────────────────────────────────────

  async listDisposals(tenantId: string, q: { skip?: number; take?: number; search?: string; status?: string; assetId?: string }) {
    const where: any = {};
    if (q.assetId) where.assetId = q.assetId;
    if (q.status) where.status = q.status;
    return this.page(this.db.inventoryAssetDisposal, where, { createdAt: 'desc' }, q.skip ?? 0, q.take ?? 50, {
      asset: { select: { id: true, assetCode: true, name: true } },
    });
  }

  async createDisposal(tenantId: string, userId: string, assetId: string, dto: CreateDisposalDto) {
    const asset = await this.db.inventoryAsset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status === 'DISPOSED') throw new BadRequestException('Asset is already disposed');
    const row = await this.db.$transaction(async (tx) => {
      const disposalNumber = await this.nextNumber(tx, tenantId, 'DISPOSAL', 'DSP');
      const disposal = await tx.inventoryAssetDisposal.create({
        data: {
          tenant: { connect: { id: tenantId } },
          asset: { connect: { id: assetId } },
          disposalNumber,
          type: dto.type as any,
          disposalDate: dto.disposalDate ? new Date(dto.disposalDate) : null,
          proceedsCents: dto.proceedsCents ?? 0,
          remarks: dto.remarks,
          createdBy: userId,
        },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_DISPOSAL_CREATED, 'InventoryAssetDisposal', disposal.id);
      return disposal;
    });
    return row;
  }

  async completeDisposal(tenantId: string, userId: string, id: string, dto: CompleteDisposalDto) {
    const disposal = await this.db.inventoryAssetDisposal.findFirst({ where: { id } });
    if (!disposal) throw new NotFoundException('Disposal not found');
    if (disposal.status !== 'DRAFT') throw new BadRequestException(`Cannot complete a disposal in state ${disposal.status}`);
    const result = await this.db.$transaction(async (tx) => {
      const completed = await tx.inventoryAssetDisposal.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          disposalDate: dto.disposalDate ? new Date(dto.disposalDate) : new Date(),
          proceedsCents: dto.proceedsCents ?? disposal.proceedsCents,
          remarks: dto.remarks ?? disposal.remarks,
          approvedBy: userId,
          completedAt: new Date(),
          updatedBy: userId,
        },
      });
      await tx.inventoryAssetAssignment.updateMany({
        where: { assetId: disposal.assetId, status: 'ACTIVE' },
        data: { status: 'RETURNED', returnedAt: new Date() },
      });
      await tx.inventoryAsset.update({
        where: { id: disposal.assetId },
        data: { status: 'DISPOSED', condition: 'DISPOSED', updatedBy: userId },
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_DISPOSAL_COMPLETED, 'InventoryAssetDisposal', id, { before: disposal, after: completed });
      return completed;
    });
    return result;
  }

  async cancelDisposal(tenantId: string, userId: string, id: string) {
    const before = await this.db.inventoryAssetDisposal.findFirst({ where: { id } });
    if (!before) throw new NotFoundException('Disposal not found');
    if (before.status !== 'DRAFT') throw new BadRequestException(`Cannot cancel a disposal in state ${before.status}`);
    const updated = await this.db.inventoryAssetDisposal.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.INVENTORY_ASSET_DISPOSAL_CANCELLED, 'InventoryAssetDisposal', id, { before, after: updated });
    return updated;
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async reportsSummary(_tenantId: string, _q: InventoryReportQueryDto) {
    const [vendors, categories, productCategories, assetCategories, products, locations, stockByProduct, lowStock, assets, assignedAssets, underMaintenance, disposedAssets, requestCounts, poOpen, pendingApprovals] = await Promise.all([
      this.db.inventoryVendor.count({ where: { deletedAt: null } }),
      this.db.inventoryCategory.count({ where: { deletedAt: null } }),
      this.db.inventoryCategory.count({ where: { deletedAt: null, kind: 'PRODUCT' } }),
      this.db.inventoryCategory.count({ where: { deletedAt: null, kind: 'ASSET' } }),
      this.db.inventoryProduct.count({ where: { deletedAt: null, isActive: true } }),
      this.db.inventoryLocation.count({ where: { deletedAt: null, isActive: true } }),
      this.db.inventoryStockItem.findMany({ where: {}, select: { quantityOnHand: true, product: { select: { unitPriceCents: true, reorderLevel: true } } } }),
      this.db.inventoryStockItem.findMany({ where: {}, select: { quantityOnHand: true, product: { select: { reorderLevel: true } } } }),
      this.db.inventoryAsset.count({ where: { deletedAt: null } }),
      this.db.inventoryAsset.count({ where: { deletedAt: null, status: 'ASSIGNED' } }),
      this.db.inventoryAsset.count({ where: { deletedAt: null, status: 'UNDER_MAINTENANCE' } }),
      this.db.inventoryAsset.count({ where: { deletedAt: null, status: 'DISPOSED' } }),
      this.db.inventoryPurchaseRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.inventoryPurchaseOrder.count({ where: { status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'] } } }),
      this.db.inventoryPurchaseRequest.count({ where: { status: 'PENDING_APPROVAL' } }),
    ]);
    const stockValueCents = stockByProduct.reduce((sum: number, s: any) => sum + s.quantityOnHand * (s.product.unitPriceCents ?? 0), 0);
    const totalUnits = stockByProduct.reduce((sum: number, s: any) => sum + s.quantityOnHand, 0);
    const lowStockCount = lowStock.filter((s: any) => s.product.reorderLevel > 0 && s.quantityOnHand <= s.product.reorderLevel).length;
    return {
      vendors,
      categories,
      productCategories,
      assetCategories,
      products,
      locations,
      totalUnits,
      stockValueCents,
      lowStockCount,
      purchaseRequestStatuses: requestCounts,
      pendingApprovals,
      openPurchaseOrders: poOpen,
      assets,
      assignedAssets,
      underMaintenance,
      disposedAssets,
    };
  }

  async reportsStock(_tenantId: string) {
    const items = await this.db.inventoryStockItem.findMany({
      where: {},
      include: { product: { select: { unitPriceCents: true, reorderLevel: true, category: { select: { id: true, name: true } } } }, location: { select: { id: true, name: true, type: true } } },
    });
    const byLocationMap = new Map<string, any>();
    const byCategoryMap = new Map<string, any>();
    for (const item of items as any[]) {
      const value = item.quantityOnHand * (item.product.unitPriceCents ?? 0);
      const low = item.product.reorderLevel > 0 && item.quantityOnHand <= item.product.reorderLevel;
      const loc = byLocationMap.get(item.location.id) ?? { locationId: item.location.id, locationName: item.location.name, type: item.location.type, items: 0, units: 0, valueCents: 0, lowStockItems: 0 };
      loc.items += 1;
      loc.units += item.quantityOnHand;
      loc.valueCents += value;
      if (low) loc.lowStockItems += 1;
      byLocationMap.set(item.location.id, loc);
      const catId = item.product.category?.id ?? 'none';
      const cat = byCategoryMap.get(catId) ?? { categoryId: catId, categoryName: item.product.category?.name ?? 'Uncategorized', items: 0, units: 0, valueCents: 0, lowStockItems: 0 };
      cat.items += 1;
      cat.units += item.quantityOnHand;
      cat.valueCents += value;
      if (low) cat.lowStockItems += 1;
      byCategoryMap.set(catId, cat);
    }
    return {
      byLocation: [...byLocationMap.values()].sort((a, b) => b.valueCents - a.valueCents),
      byCategory: [...byCategoryMap.values()].sort((a, b) => b.valueCents - a.valueCents),
    };
  }

  async reportsAssets(_tenantId: string) {
    const assets = await this.db.inventoryAsset.findMany({
      where: { deletedAt: null },
      select: {
        status: true,
        currentBookValueCents: true,
        purchaseCostCents: true,
        category: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
    const byStatusMap = new Map<string, any>();
    const byCategoryMap = new Map<string, any>();
    let totalCostCents = 0;
    let totalBookValueCents = 0;
    for (const asset of assets as any[]) {
      const cost = asset.purchaseCostCents ?? 0;
      const book = asset.currentBookValueCents ?? cost;
      totalCostCents += cost;
      totalBookValueCents += book;
      const st = byStatusMap.get(asset.status) ?? { status: asset.status, count: 0, costCents: 0, bookValueCents: 0 };
      st.count += 1;
      st.costCents += cost;
      st.bookValueCents += book;
      byStatusMap.set(asset.status, st);
      const catId = asset.category?.id ?? 'none';
      const cat = byCategoryMap.get(catId) ?? { categoryId: catId, categoryName: asset.category?.name ?? 'Uncategorized', count: 0, costCents: 0, bookValueCents: 0 };
      cat.count += 1;
      cat.costCents += cost;
      cat.bookValueCents += book;
      byCategoryMap.set(catId, cat);
    }
    return {
      totalAssets: assets.length,
      totalCostCents,
      totalBookValueCents,
      byStatus: [...byStatusMap.values()],
      byCategory: [...byCategoryMap.values()].sort((a, b) => b.bookValueCents - a.bookValueCents),
    };
  }
}