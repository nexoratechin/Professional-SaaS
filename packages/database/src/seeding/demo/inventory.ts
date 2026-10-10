/**
 * Demo module 13 — inventory & assets: vendors, product/asset categories, products with stock
 * items and movements, a purchase request -> order -> goods receipt flow, a stock adjustment, and
 * tracked assets with assignments and maintenance.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import { INVENTORY_VENDORS } from './names';
import type { SeededPeople } from './people';

export interface InventoryInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedInventory(input: InventoryInput): Promise<{ products: number; assets: number; receipts: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`inventory/${segment}`);

  // Global sequences for each number series the module issues.
  const sequences = [
    { kind: 'VENDOR', prefix: 'VEN', next: 10 },
    { kind: 'CATEGORY', prefix: 'CAT', next: 10 },
    { kind: 'PRODUCT', prefix: 'PRD', next: 20 },
    { kind: 'LOCATION', prefix: 'LOC', next: 10 },
    { kind: 'PURCHASE_REQUEST', prefix: 'PR', next: 10 },
    { kind: 'PURCHASE_ORDER', prefix: 'PO', next: 10 },
    { kind: 'GOODS_RECEIPT', prefix: 'GRN', next: 10 },
    { kind: 'STOCK_ADJUSTMENT', prefix: 'SA', next: 10 },
    { kind: 'ASSET', prefix: 'AST', next: 20 },
    { kind: 'ASSET_TAG', prefix: 'TAG', next: 20 },
    { kind: 'MAINTENANCE', prefix: 'MNT', next: 10 },
  ] as const;
  for (const sequence of sequences) {
    await prisma.inventorySequence.upsert({
      where: { tenantId_kind_prefix: { tenantId, kind: sequence.kind, prefix: sequence.prefix } },
      update: { nextValue: sequence.next },
      create: {
        id: id(`sequence/${sequence.kind}`),
        tenantId,
        kind: sequence.kind,
        prefix: sequence.prefix,
        nextValue: sequence.next,
      },
    });
  }

  // ------------------------------------------------------------------ vendors + categories
  const vendorIds: Record<string, string> = {};
  for (const vendor of INVENTORY_VENDORS) {
    const row = await prisma.inventoryVendor.upsert({
      where: { tenantId_code: { tenantId, code: vendor.code } },
      update: { name: vendor.name, contactPerson: vendor.contactPerson, status: 'ACTIVE' },
      create: {
        id: id(`vendor/${vendor.code}`),
        tenantId,
        code: vendor.code,
        name: vendor.name,
        gstin: vendor.gstin,
        contactPerson: vendor.contactPerson,
        phone: '+919822011001',
        email: `sales@${vendor.code.toLowerCase()}.example.com`,
        city: vendor.city,
        state: 'Maharashtra',
        country: 'India',
        paymentTerms: '30 days from invoice',
        status: 'ACTIVE',
        createdBy: creator,
      },
    });
    vendorIds[vendor.code] = row.id;
  }

  const categorySpecs = [
    { key: 'cat-stationery', kind: 'PRODUCT' as const, code: 'STATIONERY', name: 'Stationery & Office Supplies' },
    { key: 'cat-lab', kind: 'PRODUCT' as const, code: 'LAB_CONSUMABLE', name: 'Laboratory Consumables' },
    { key: 'cat-electronics', kind: 'PRODUCT' as const, code: 'ELECTRONICS', name: 'Electronics & Accessories' },
    { key: 'cat-furniture', kind: 'PRODUCT' as const, code: 'FURNITURE', name: 'Furniture' },
    { key: 'cat-it-assets', kind: 'ASSET' as const, code: 'IT_EQUIPMENT', name: 'IT Equipment' },
    { key: 'cat-lab-assets', kind: 'ASSET' as const, code: 'LAB_EQUIPMENT', name: 'Laboratory Equipment' },
    { key: 'cat-furn-assets', kind: 'ASSET' as const, code: 'FURNITURE_ASSET', name: 'Furniture & Fixtures' },
  ];
  const categoryIds: Record<string, string> = {};
  for (const category of categorySpecs) {
    const row = await prisma.inventoryCategory.upsert({
      where: { tenantId_kind_code: { tenantId, kind: category.kind, code: category.code } },
      update: { name: category.name, deletedAt: null },
      create: {
        id: id(`category/${category.code}`),
        tenantId,
        kind: category.kind,
        code: category.code,
        name: category.name,
        createdBy: creator,
      },
    });
    categoryIds[category.key] = row.id;
  }

  const productSpecs = [
    { key: 'a4-paper', category: 'cat-stationery', code: 'PRD-A4', name: 'A4 Copier Paper (75 GSM)', unit: 'REAM', price: 35_000, reorder: 40 },
    { key: 'marker', category: 'cat-stationery', code: 'PRD-MARKER', name: 'Whiteboard Marker (Blue)', unit: 'PCS', price: 4_500, reorder: 60 },
    { key: 'gloves', category: 'cat-lab', code: 'PRD-GLOVES', name: 'Nitrile Lab Gloves (Medium)', unit: 'PAIR', price: 1_200, reorder: 200 },
    { key: 'slides', category: 'cat-lab', code: 'PRD-SLIDES', name: 'Microscope Slides (Box of 50)', unit: 'BOX', price: 22_000, reorder: 15 },
    { key: 'hdmi', category: 'cat-electronics', code: 'PRD-HDMI', name: 'HDMI 2.0 Cable — 3m', unit: 'PCS', price: 55_000, reorder: 10 },
    { key: 'dock', category: 'cat-electronics', code: 'PRD-DOCK', name: 'USB-C Docking Station', unit: 'PCS', price: 480_000, reorder: 5 },
    { key: 'chair', category: 'cat-furniture', code: 'PRD-CHAIR', name: 'Study Chair (Ergonomic)', unit: 'PCS', price: 350_000, reorder: 20 },
    { key: 'notice-board', category: 'cat-furniture', code: 'PRD-NOTICE', name: 'Notice Board 4x3 ft', unit: 'PCS', price: 250_000, reorder: 4 },
  ] as const;
  const productIds: Record<string, string> = {};
  for (const product of productSpecs) {
    const row = await prisma.inventoryProduct.upsert({
      where: { tenantId_code: { tenantId, code: product.code } },
      update: { name: product.name, unitPriceCents: product.price, isActive: true },
      create: {
        id: id(`product/${product.code}`),
        tenantId,
        categoryId: categoryIds[product.category] as string,
        code: product.code,
        sku: `SKU-${product.code}`,
        name: product.name,
        unit: product.unit,
        unitPriceCents: product.price,
        reorderLevel: product.reorder,
        createdBy: creator,
      },
    });
    productIds[product.key] = row.id;
  }

  const locationSpecs = [
    { key: 'central', code: 'STORE-CENTRAL', name: 'Central Stores', type: 'WAREHOUSE' as const, campusKey: 'campusMain', buildingKey: 'buildingBlockA', roomKey: null },
    { key: 'lab', code: 'STORE-LAB', name: 'Laboratory Stores', type: 'LAB' as const, campusKey: 'campusMain', buildingKey: 'buildingBlockA', roomKey: 'roomA201' },
    { key: 'city', code: 'STORE-CITY', name: 'City Campus Store', type: 'STORE' as const, campusKey: 'campusCity', buildingKey: 'buildingCity', roomKey: null },
  ];
  const locationIds: Record<string, string> = {};
  for (const location of locationSpecs) {
    const row = await prisma.inventoryLocation.upsert({
      where: { tenantId_code: { tenantId, code: location.code } },
      update: { name: location.name, isActive: true },
      create: {
        id: id(`location/${location.code}`),
        tenantId,
        code: location.code,
        name: location.name,
        type: location.type,
        campusId: org[location.campusKey] as string,
        buildingId: location.buildingKey ? (org[location.buildingKey] as string) : null,
        roomId: location.roomKey ? (org[location.roomKey] as string) : null,
        createdBy: creator,
      },
    });
    locationIds[location.key] = row.id;
  }

  // ------------------------------------------------------------------ stock items + initial movements
  let stockItems = 0;
  for (const [index, product] of productSpecs.entries()) {
    const locationKey = product.category === 'cat-lab' ? 'lab' : 'central';
    const quantity = spread(index + 1, 7, 25, 180);
    const stockItem = await prisma.inventoryStockItem.upsert({
      where: {
        tenantId_locationId_productId: {
          tenantId,
          locationId: locationIds[locationKey] as string,
          productId: productIds[product.key] as string,
        },
      },
      update: { quantityOnHand: quantity },
      create: {
        id: id(`stock/${product.code}/${locationKey}`),
        tenantId,
        productId: productIds[product.key] as string,
        locationId: locationIds[locationKey] as string,
        quantityOnHand: quantity,
        reservedQuantity: 0,
        lastMovementAt: demoDate('2026-07-01'),
        createdBy: creator,
      },
    });
    await prisma.inventoryStockMovement.upsert({
      where: { id: id(`movement/${product.code}/initial`) },
      update: {},
      create: {
        id: id(`movement/${product.code}/initial`),
        tenantId,
        productId: productIds[product.key] as string,
        locationId: locationIds[locationKey] as string,
        type: 'INITIAL',
        quantityDelta: quantity,
        quantityBefore: 0,
        quantityAfter: quantity,
        reason: 'Opening stock — migrated from legacy register',
        referenceType: 'STOCK_ITEM',
        referenceId: stockItem.id,
        postedBy: creator,
        occurredAt: demoDate('2026-07-01'),
      },
    });
    stockItems += 1;
  }

  // ------------------------------------------------------------------ purchase request -> order -> receipt
  const request1 = await prisma.inventoryPurchaseRequest.upsert({
    where: { id: id('pr/1') },
    update: { status: 'PENDING_APPROVAL' },
    create: {
      id: id('pr/1'),
      tenantId,
      requestNumber: 'PR-000001',
      status: 'PENDING_APPROVAL',
      requestedBy: people.staff['fac-me1']?.userId as string,
      requestedAt: demoDate('2026-10-01'),
      departmentId: org['deptMe'] as string,
      vendorId: vendorIds['VEN-LAB'] as string,
      requiresApproval: true,
      notes: 'Consumables for the mechanics laboratory',
      createdBy: creator,
    },
  });
  const request1Items = [
    { product: 'gloves', quantity: 200 },
    { product: 'slides', quantity: 20 },
  ];
  for (const [index, item] of request1Items.entries()) {
    await prisma.inventoryPurchaseRequestItem.upsert({
      where: { id: id(`pr-item/1/${index + 1}`) },
      update: {},
      create: {
        id: id(`pr-item/1/${index + 1}`),
        tenantId,
        requestId: request1.id,
        productId: productIds[item.product] as string,
        quantityRequested: item.quantity,
        quantityApproved: item.quantity,
        unitPriceCents: productSpecs.find((product) => product.key === item.product)?.price,
      },
    });
  }

  const request2 = await prisma.inventoryPurchaseRequest.upsert({
    where: { id: id('pr/2') },
    update: { status: 'CONVERTED' },
    create: {
      id: id('pr/2'),
      tenantId,
      requestNumber: 'PR-000002',
      status: 'CONVERTED',
      requestedBy: people.staff['librarian']?.userId as string,
      requestedAt: demoDate('2026-08-10'),
      departmentId: org['deptAdmin'] as string,
      vendorId: vendorIds['VEN-TECH'] as string,
      requiresApproval: true,
      reviewedById: creator,
      approvedById: creator,
      approvedAt: demoDate('2026-08-12'),
      notes: 'AV and dock equipment for seminar rooms',
      createdBy: creator,
    },
  });
  const request2Items = [
    { product: 'hdmi', quantity: 20 },
    { product: 'dock', quantity: 5 },
  ];
  for (const [index, item] of request2Items.entries()) {
    await prisma.inventoryPurchaseRequestItem.upsert({
      where: { id: id(`pr-item/2/${index + 1}`) },
      update: {},
      create: {
        id: id(`pr-item/2/${index + 1}`),
        tenantId,
        requestId: request2.id,
        productId: productIds[item.product] as string,
        quantityRequested: item.quantity,
        quantityApproved: item.quantity,
        unitPriceCents: productSpecs.find((product) => product.key === item.product)?.price,
      },
    });
  }

  const po1 = await prisma.inventoryPurchaseOrder.upsert({
    where: { id: id('po/1') },
    update: { status: 'RECEIVED', receivedAt: demoDate('2026-08-28') },
    create: {
      id: id('po/1'),
      tenantId,
      poNumber: 'PO-000001',
      vendorId: vendorIds['VEN-TECH'] as string,
      status: 'RECEIVED',
      purchaseRequestId: request2.id,
      orderDate: demoDate('2026-08-14'),
      expectedDate: demoDate('2026-08-28'),
      totalCents: 20 * 55_000 + 5 * 480_000,
      approvedById: creator,
      approvedAt: demoDate('2026-08-14'),
      receivedAt: demoDate('2026-08-28'),
      notes: 'Against PR-000002',
      createdBy: creator,
    },
  });
  const po1Items: Array<{ key: string; product: string; quantity: number; price: number }> = [
    { key: 'hdmi', product: 'hdmi', quantity: 20, price: 55_000 },
    { key: 'dock', product: 'dock', quantity: 5, price: 480_000 },
  ];
  const po1ItemIds: Record<string, string> = {};
  for (const item of po1Items) {
    const row = await prisma.inventoryPurchaseOrderItem.upsert({
      where: { id: id(`po-item/1/${item.key}`) },
      update: { quantityReceived: item.quantity },
      create: {
        id: id(`po-item/1/${item.key}`),
        tenantId,
        poId: po1.id,
        productId: productIds[item.product] as string,
        quantityOrdered: item.quantity,
        quantityReceived: item.quantity,
        unitPriceCents: item.price,
      },
    });
    po1ItemIds[item.key] = row.id;
  }

  const receipt = await prisma.inventoryGoodsReceipt.upsert({
    where: { id: id('grn/1') },
    update: { status: 'COMPLETED' },
    create: {
      id: id('grn/1'),
      tenantId,
      grnNumber: 'GRN-000001',
      vendorId: vendorIds['VEN-TECH'] as string,
      poId: po1.id,
      status: 'COMPLETED',
      receivedAt: demoDate('2026-08-28'),
      receivedBy: people.staff['campusAdmin']?.userId,
      notes: 'All items received in good condition',
      createdBy: creator,
    },
  });
  for (const item of po1Items) {
    await prisma.inventoryGoodsReceiptItem.upsert({
      where: { id: id(`grn-item/1/${item.key}`) },
      update: {},
      create: {
        id: id(`grn-item/1/${item.key}`),
        tenantId,
        grnId: receipt.id,
        poItemId: po1ItemIds[item.key],
        productId: productIds[item.product] as string,
        locationId: locationIds['central'] as string,
        quantityReceived: item.quantity,
        unitPriceCents: item.price,
      },
    });

    // Stock movement + on-hand bump for the receipt line.
    const stockItem = await prisma.inventoryStockItem.findUniqueOrThrow({
      where: {
        tenantId_locationId_productId: {
          tenantId,
          locationId: locationIds['central'] as string,
          productId: productIds[item.product] as string,
        },
      },
    });
    const before = stockItem.quantityOnHand;
    const after = before + item.quantity;
    await prisma.inventoryStockItem.update({
      where: { id: stockItem.id },
      data: { quantityOnHand: after, lastMovementAt: demoDate('2026-08-28') },
    });
    await prisma.inventoryStockMovement.upsert({
      where: { id: id(`movement/${item.key}/receipt`) },
      update: {},
      create: {
        id: id(`movement/${item.key}/receipt`),
        tenantId,
        productId: productIds[item.product] as string,
        locationId: locationIds['central'] as string,
        type: 'RECEIPT',
        quantityDelta: item.quantity,
        quantityBefore: before,
        quantityAfter: after,
        reason: `Goods receipt ${receipt.grnNumber}`,
        referenceType: 'GOODS_RECEIPT',
        referenceId: receipt.id,
        postedBy: creator,
        occurredAt: demoDate('2026-08-28'),
      },
    });
  }

  // Stock adjustment: damaged paper written off and a stock-count correction for markers.
  const adjustment = await prisma.inventoryStockAdjustment.upsert({
    where: { id: id('adjustment/1') },
    update: { status: 'COMPLETED' },
    create: {
      id: id('adjustment/1'),
      tenantId,
      adjustmentNumber: 'SA-000001',
      locationId: locationIds['central'] as string,
      status: 'COMPLETED',
      reason: 'DAMAGE_WRITE_OFF',
      description: 'Monsoon damage write-off and quarterly stock-count correction',
      adjustedBy: people.staff['campusAdmin']?.userId,
      adjustedAt: demoDate('2026-09-30'),
      createdBy: creator,
    },
  });
  const adjustmentItems = [
    { key: 'paper', product: 'a4-paper', delta: -12 },
    { key: 'marker', product: 'marker', delta: 6 },
  ];
  for (const item of adjustmentItems) {
    const stockItem = await prisma.inventoryStockItem.findUniqueOrThrow({
      where: {
        tenantId_locationId_productId: {
          tenantId,
          locationId: locationIds['central'] as string,
          productId: productIds[item.product] as string,
        },
      },
    });
    await prisma.inventoryStockMovement.upsert({
      where: { id: id(`movement/${item.key}/adjustment`) },
      update: {},
      create: {
        id: id(`movement/${item.key}/adjustment`),
        tenantId,
        productId: productIds[item.product] as string,
        locationId: locationIds['central'] as string,
        type: item.delta > 0 ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_SUBTRACT',
        quantityDelta: item.delta,
        quantityBefore: stockItem.quantityOnHand,
        quantityAfter: stockItem.quantityOnHand + item.delta,
        reason: item.delta > 0 ? 'Stock-count correction' : 'Monsoon damage write-off',
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: adjustment.id,
        postedBy: creator,
        occurredAt: demoDate('2026-09-30'),
      },
    });
    await prisma.inventoryStockItem.update({
      where: { id: stockItem.id },
      data: { quantityOnHand: stockItem.quantityOnHand + item.delta, lastMovementAt: demoDate('2026-09-30') },
    });
  }

  // ------------------------------------------------------------------ assets
  const assetSpecs = [
    { key: 'laptop-1', code: 'AST-000001', tag: 'TAG-000001', name: 'Dell Latitude 5440 — Faculty Laptop', category: 'cat-it-assets', cost: 8_500_000, purchase: '2024-07-10', status: 'ASSIGNED' as const, assignee: 'employee' as const, assigneeKey: 'fac-cse1', condition: 'GOOD' as const, life: 36 },
    { key: 'laptop-2', code: 'AST-000002', tag: 'TAG-000002', name: 'Lenovo ThinkPad E14 — Faculty Laptop', category: 'cat-it-assets', cost: 7_900_000, purchase: '2024-07-10', status: 'ASSIGNED' as const, assignee: 'employee' as const, assigneeKey: 'fac-ece1', condition: 'GOOD' as const, life: 36 },
    { key: 'projector-1', code: 'AST-000003', tag: 'TAG-000003', name: 'Epson EB-L200F Projector — Seminar Hall', category: 'cat-it-assets', cost: 5_600_000, purchase: '2023-06-15', status: 'ASSIGNED' as const, assignee: 'department' as const, assigneeKey: 'deptCse', condition: 'FAIR' as const, life: 60 },
    { key: 'microscope-1', code: 'AST-000004', tag: 'TAG-000004', name: 'Olympus CX23 Laboratory Microscope', category: 'cat-lab-assets', cost: 12_500_000, purchase: '2022-08-01', status: 'UNDER_MAINTENANCE' as const, assignee: null, assigneeKey: null, condition: 'FAIR' as const, life: 84 },
    { key: 'printer-1', code: 'AST-000005', tag: 'TAG-000005', name: 'HP LaserJet Pro — Administration', category: 'cat-it-assets', cost: 3_200_000, purchase: '2025-01-20', status: 'IN_STOCK' as const, assignee: null, assigneeKey: null, condition: 'NEW' as const, life: 48 },
    { key: 'chairs-1', code: 'AST-000006', tag: 'TAG-000006', name: 'Library Reading Chairs (set of 10)', category: 'cat-furn-assets', cost: 4_500_000, purchase: '2025-06-05', status: 'IN_STOCK' as const, assignee: null, assigneeKey: null, condition: 'GOOD' as const, life: 96 },
  ] as const;

  let assets = 0;
  for (const asset of assetSpecs) {
    const row = await prisma.inventoryAsset.upsert({
      where: { tenantId_assetCode: { tenantId, assetCode: asset.code } },
      update: { status: asset.status, currentBookValueCents: asset.cost },
      create: {
        id: id(`asset/${asset.code}`),
        tenantId,
        assetCode: asset.code,
        tagNumber: asset.tag,
        name: asset.name,
        categoryId: categoryIds[asset.category] as string,
        vendorId: vendorIds['VEN-TECH'] as string,
        locationId: locationIds['central'] as string,
        serialNumber: `SN-${asset.code}`,
        brand: asset.name.split(' ')[0],
        purchaseDate: demoDate(asset.purchase),
        purchaseCostCents: asset.cost,
        warrantyStartDate: demoDate(asset.purchase),
        warrantyEndDate: demoDate(`${Number(asset.purchase.slice(0, 4)) + 3}${asset.purchase.slice(4)}`),
        warrantyProvider: 'Authorised service centre',
        status: asset.status,
        condition: asset.condition,
        depreciationMethod: 'STRAIGHT_LINE',
        usefulLifeMonths: asset.life,
        salvageValueCents: Math.round(asset.cost * 0.05),
        currentBookValueCents: asset.cost,
        createdBy: creator,
      },
    });
    assets += 1;

    if (asset.assignee === 'employee' && asset.assigneeKey) {
      const employeeId = people.staff[asset.assigneeKey]?.employeeId;
      await prisma.inventoryAssetAssignment.upsert({
        where: { id: id(`asset-assignment/${asset.code}`) },
        update: { status: 'ACTIVE' },
        create: {
          id: id(`asset-assignment/${asset.code}`),
          tenantId,
          assetId: row.id,
          assigneeType: 'EMPLOYEE',
          employeeId,
          assigneeName: people.staff[asset.assigneeKey]?.fullName,
          assignedBy: creator,
          assignedAt: demoDate('2024-07-15'),
          status: 'ACTIVE',
          notes: 'Issued for academic duties',
        },
      });
    }
    if (asset.assignee === 'department' && asset.assigneeKey) {
      await prisma.inventoryAssetAssignment.upsert({
        where: { id: id(`asset-assignment/${asset.code}`) },
        update: { status: 'ACTIVE' },
        create: {
          id: id(`asset-assignment/${asset.code}`),
          tenantId,
          assetId: row.id,
          assigneeType: 'DEPARTMENT',
          departmentId: org[asset.assigneeKey] as string,
          campusId: org['campusMain'] as string,
          assignedBy: creator,
          assignedAt: demoDate('2023-06-20'),
          status: 'ACTIVE',
          notes: 'Fixed installation in the seminar hall',
        },
      });
    }
  }

  await prisma.inventoryAssetMaintenance.upsert({
    where: { id: id('asset-maintenance/1') },
    update: { status: 'IN_PROGRESS' },
    create: {
      id: id('asset-maintenance/1'),
      tenantId,
      assetId: id('asset/AST-000004'),
      maintenanceNumber: 'MNT-000001',
      vendorId: vendorIds['VEN-LAB'] as string,
      type: 'CORRECTIVE',
      status: 'IN_PROGRESS',
      scheduledDate: demoDate('2026-10-02'),
      startedAt: demoDate('2026-10-05'),
      description: 'Eyepiece replacement and stage alignment',
      costCents: 320_000,
      performedBy: 'Olympus Authorised Service',
      createdBy: creator,
    },
  });

  logDemo('inventory', {
    products: productSpecs.length,
    stockItems,
    assets,
    receipts: 1,
  });

  return { products: productSpecs.length, assets, receipts: 1 };
}
