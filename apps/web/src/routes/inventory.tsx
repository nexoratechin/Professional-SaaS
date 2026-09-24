import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  AdjustmentRow,
  AssetReport,
  AssetRow,
  CategoryRow,
  GoodsReceiptRow,
  INVENTORY_CREATE_PERMISSION,
  INVENTORY_DELETE_PERMISSION,
  INVENTORY_MANAGE_PERMISSION,
  INVENTORY_UPDATE_PERMISSION,
  INVENTORY_VIEW_PERMISSION,
  InventorySummary,
  LocationRow,
  LookupsPayload,
  MaintenanceRow,
  Paged,
  ProductRow,
  PurchaseOrderRow,
  PurchaseRequestRow,
  StockItemRow,
  StockMovementRow,
  StockReport,
  TransferRow,
  VendorRow,
  WarrantyClaimRow,
} from './inventory-shared';

export function InventoryPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'summary' | 'vendors' | 'categories' | 'products' | 'locations' | 'stock' | 'purchasing' | 'assets'>('summary');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookups, setLookups] = useState<LookupsPayload | null>(null);

  const canView = permissions.includes(INVENTORY_VIEW_PERMISSION);
  const canCreate = permissions.includes(INVENTORY_CREATE_PERMISSION);
  const canUpdate = permissions.includes(INVENTORY_UPDATE_PERMISSION);
  const canDelete = permissions.includes(INVENTORY_DELETE_PERMISSION);
  const canManage = permissions.includes(INVENTORY_MANAGE_PERMISSION);

  useEffect(() => {
    if (!canView) return;
    apiFetch<LookupsPayload>('/inventory/lookups').then(setLookups).catch(() => setLookups(null));
  }, [canView]);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view the inventory module.</p>;
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'categories', label: 'Categories' },
    { key: 'products', label: 'Products' },
    { key: 'locations', label: 'Locations' },
    { key: 'stock', label: 'Stock' },
    { key: 'purchasing', label: 'Purchasing' },
    { key: 'assets', label: 'Assets' },
  ];

  return (
    <div style={{ maxWidth: 1240, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Inventory &amp; Assets</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'summary' && <SummaryTab onError={setError} />}
      {tab === 'vendors' && <VendorsTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'categories' && <CategoriesTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'products' && <ProductsTab lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'locations' && <LocationsTab lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'stock' && <StockTab lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} onError={setError} onNotice={setNotice} />}
      {tab === 'purchasing' && <PurchasingTab lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'assets' && <AssetsTab lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
    </div>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  return `₹${((cents ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function run(
  action: () => Promise<unknown>,
  success: string,
  onNotice: (msg: string | null) => void,
  onError: (msg: string | null) => void,
) {
  try {
    await action();
    onNotice(success);
    onError(null);
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Operation failed.');
  }
}

function useSimpleList<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await apiFetch<T[]>(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, load, error };
}

function usePagedList<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<Paged<T>>(path);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, total, load, error };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: '#15803d',
    COMPLETED: '#15803d',
    APPROVED: '#15803d',
    RECEIVED: '#15803d',
    ISSUED: '#3b82f6',
    PENDING: '#f59e0b',
    PENDING_APPROVAL: '#f59e0b',
    DRAFT: '#6b7280',
    IN_PROGRESS: '#3b82f6',
    ASSIGNED: '#3b82f6',
    PARTIALLY_RECEIVED: '#f59e0b',
    REJECTED: '#b91c1c',
    CANCELLED: '#b91c1c',
    DISPOSED: '#6b7280',
  };
  return <span style={{ color: colors[status] ?? '#374151', fontWeight: 600 }}>{status}</span>;
}

const th: React.CSSProperties = { padding: 8 };
const td: React.CSSProperties = { padding: 8 };

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
          {head.map((h) => (
            <th key={h} style={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

function SummaryTab({ onError }: { onError: (msg: string | null) => void }) {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [stock, setStock] = useState<StockReport | null>(null);
  const [assets, setAssets] = useState<AssetReport | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      const [s, st, a] = await Promise.all([
        apiFetch<InventorySummary>('/inventory/reports/summary'),
        apiFetch<StockReport>('/inventory/reports/stock'),
        apiFetch<AssetReport>('/inventory/reports/assets'),
      ]);
      setSummary(s);
      setStock(st);
      setAssets(a);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load inventory summary.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return null;

  const cards: { label: string; value: string; color?: string }[] = [
    { label: 'Vendors', value: String(summary.vendors) },
    { label: 'Categories', value: String(summary.categories) },
    { label: 'Products', value: String(summary.products) },
    { label: 'Locations', value: String(summary.locations) },
    { label: 'Units on hand', value: String(summary.totalUnits) },
    { label: 'Stock value', value: fmtCents(summary.stockValueCents), color: '#15803d' },
    { label: 'Low stock', value: String(summary.lowStockCount), color: summary.lowStockCount > 0 ? '#b91c1c' : '#15803d' },
    { label: 'Pending approvals', value: String(summary.pendingApprovals), color: summary.pendingApprovals > 0 ? '#f59e0b' : '#15803d' },
    { label: 'Open POs', value: String(summary.openPurchaseOrders) },
    { label: 'Assets', value: String(summary.assets) },
    { label: 'Assigned', value: String(summary.assignedAssets), color: '#3b82f6' },
    { label: 'Under maintenance', value: String(summary.underMaintenance), color: '#f59e0b' },
    { label: 'Disposed', value: String(summary.disposedAssets), color: '#6b7280' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        {cards.map((c) => (
          <Card key={c.label} style={{ padding: '0.75rem 1rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{c.label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: c.color ?? '#111827' }}>{c.value}</div>
          </Card>
        ))}
      </div>

      {stock && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 300 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Stock by location</h2>
            <Table head={['Location', 'Items', 'Units', 'Value', 'Low']}>
              {stock.byLocation.map((l) => (
                <tr key={l.locationId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>{l.locationName}</td>
                  <td style={td}>{l.items}</td>
                  <td style={td}>{l.units}</td>
                  <td style={td}>{fmtCents(l.valueCents)}</td>
                  <td style={{ ...td, color: l.lowStockItems > 0 ? '#b91c1c' : undefined }}>{l.lowStockItems}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card style={{ flex: 1, minWidth: 300 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Stock by category</h2>
            <Table head={['Category', 'Items', 'Units', 'Value', 'Low']}>
              {stock.byCategory.map((c) => (
                <tr key={c.categoryId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>{c.categoryName}</td>
                  <td style={td}>{c.items}</td>
                  <td style={td}>{c.units}</td>
                  <td style={td}>{fmtCents(c.valueCents)}</td>
                  <td style={{ ...td, color: c.lowStockItems > 0 ? '#b91c1c' : undefined }}>{c.lowStockItems}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      {assets && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 300 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Assets by status</h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Cost {fmtCents(assets.totalCostCents)} · Book value {fmtCents(assets.totalBookValueCents)}
            </p>
            <Table head={['Status', 'Count', 'Cost', 'Book value']}>
              {assets.byStatus.map((s) => (
                <tr key={s.status} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  <td style={td}>{s.count}</td>
                  <td style={td}>{fmtCents(s.costCents)}</td>
                  <td style={td}>{fmtCents(s.bookValueCents)}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card style={{ flex: 1, minWidth: 300 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Assets by category</h2>
            <Table head={['Category', 'Count', 'Cost', 'Book value']}>
              {assets.byCategory.map((c) => (
                <tr key={c.categoryId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>{c.categoryName}</td>
                  <td style={td}>{c.count}</td>
                  <td style={td}>{fmtCents(c.costCents)}</td>
                  <td style={td}>{fmtCents(c.bookValueCents)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

// ── Vendors ─────────────────────────────────────────────────────────────────

function VendorsTab({ canCreate, canUpdate, canDelete, onError, onNotice }: PanelProps) {
  const { rows, load } = usePagedList<VendorRow>('/inventory/vendors?take=100');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);

  const save = async (f: Record<string, string>) => {
    const body = {
      code: f.code,
      name: f.name,
      ...(f.gstin?.trim() ? { gstin: f.gstin.trim() } : {}),
      ...(f.contactPerson?.trim() ? { contactPerson: f.contactPerson.trim() } : {}),
      ...(f.phone?.trim() ? { phone: f.phone.trim() } : {}),
      ...(f.email?.trim() ? { email: f.email.trim() } : {}),
      ...(f.city?.trim() ? { city: f.city.trim() } : {}),
      status: f.status || 'ACTIVE',
    };
    if (f.__isNew === '1') await run(() => apiFetch('/inventory/vendors', { method: 'POST', body: JSON.stringify(body) }), 'Vendor created.', onNotice, onError);
    else if (f.__id) await run(() => apiFetch(`/inventory/vendors/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Vendor updated.', onNotice, onError);
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this vendor?')) return;
    await run(() => apiFetch(`/inventory/vendors/${id}`, { method: 'DELETE' }), 'Vendor deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Vendors ({rows.length})</h2>
        {canCreate && <Button onClick={() => setEditor({ __isNew: '1', code: '', name: '', gstin: '', contactPerson: '', phone: '', email: '', city: '', status: 'ACTIVE' })}>New vendor</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No vendors yet.</p>}
      {rows.length > 0 && (
        <Table head={['Code', 'Name', 'GSTIN', 'Contact', 'City', 'Status', 'Actions']}>
          {rows.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{v.code}</td>
              <td style={td}>{v.name}</td>
              <td style={td}>{v.gstin ?? '—'}</td>
              <td style={td}>{v.contactPerson ?? '—'}{v.phone ? ` · ${v.phone}` : ''}</td>
              <td style={td}>{v.city ?? '—'}</td>
              <td style={td}><StatusBadge status={v.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor({ __id: v.id, code: v.code, name: v.name, gstin: v.gstin ?? '', contactPerson: v.contactPerson ?? '', phone: v.phone ?? '', email: v.email ?? '', city: v.city ?? '', status: v.status })}>Edit</Button>}
                {canDelete && <Button variant="secondary" onClick={() => void remove(v.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editor && (
        <InlineEditor
          title={editor.__isNew === '1' ? 'New vendor' : 'Edit vendor'}
          value={editor}
          onChange={setEditor}
          onSave={() => void save(editor)}
          canSave={canCreate || canUpdate}
          onClose={() => setEditor(null)}
          fields={[
            { key: 'code', placeholder: 'Code', width: 120 },
            { key: 'name', placeholder: 'Name', flex: true },
            { key: 'gstin', placeholder: 'GSTIN', width: 160 },
            { key: 'contactPerson', placeholder: 'Contact person', width: 170 },
            { key: 'phone', placeholder: 'Phone', width: 140 },
            { key: 'email', placeholder: 'Email', width: 200 },
            { key: 'city', placeholder: 'City', width: 140 },
          ]}
        />
      )}
    </Card>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function CategoriesTab({ canCreate, canUpdate, canDelete, onError, onNotice }: PanelProps) {
  const { rows, load } = useSimpleList<CategoryRow>('/inventory/categories');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);

  const save = async (f: Record<string, string>) => {
    const body = {
      ...(f.__isNew === '1' ? { kind: f.kind || 'PRODUCT' } : {}),
      code: f.code,
      name: f.name,
      ...(f.description?.trim() ? { description: f.description.trim() } : {}),
      ...(f.parentId ? { parentId: f.parentId } : {}),
    };
    if (f.__isNew === '1') await run(() => apiFetch('/inventory/categories', { method: 'POST', body: JSON.stringify(body) }), 'Category created.', onNotice, onError);
    else if (f.__id) await run(() => apiFetch(`/inventory/categories/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Category updated.', onNotice, onError);
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this category?')) return;
    await run(() => apiFetch(`/inventory/categories/${id}`, { method: 'DELETE' }), 'Category deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Categories ({rows.length})</h2>
        {canCreate && <Button onClick={() => setEditor({ __isNew: '1', kind: 'PRODUCT', code: '', name: '', description: '' })}>New category</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No categories yet.</p>}
      {rows.length > 0 && (
        <Table head={['Kind', 'Code', 'Name', 'Products', 'Assets', 'Actions']}>
          {rows.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{c.kind}</td>
              <td style={td}>{c.code}</td>
              <td style={td}>{c.name}</td>
              <td style={td}>{c._count?.products ?? 0}</td>
              <td style={td}>{c._count?.assets ?? 0}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor({ __id: c.id, kind: c.kind, code: c.code, name: c.name, description: c.description ?? '', parentId: c.parentId ?? '' })}>Edit</Button>}
                {canDelete && <Button variant="secondary" onClick={() => void remove(c.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editor && (
        <InlineEditor
          title={editor.__isNew === '1' ? 'New category' : 'Edit category'}
          value={editor}
          onChange={setEditor}
          onSave={() => void save(editor)}
          canSave={canCreate || canUpdate}
          onClose={() => setEditor(null)}
          fields={[
            { key: 'code', placeholder: 'Code', width: 120 },
            { key: 'name', placeholder: 'Name', flex: true },
            { key: 'description', placeholder: 'Description', flex: true },
          ]}
        />
      )}
    </Card>
  );
}

// ── Products ────────────────────────────────────────────────────────────────

function ProductsTab({ lookups, canCreate, canUpdate, canDelete, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<ProductRow>('/inventory/products?take=100');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);
  const productCategories = (lookups?.categories ?? []).filter((c) => c.kind === 'PRODUCT');

  const save = async (f: Record<string, string>) => {
    const body = {
      code: f.code,
      name: f.name,
      categoryId: f.categoryId,
      ...(f.sku?.trim() ? { sku: f.sku.trim() } : {}),
      ...(f.unit?.trim() ? { unit: f.unit.trim() } : {}),
      ...(f.unitPriceCents ? { unitPriceCents: Number(f.unitPriceCents) } : {}),
      ...(f.reorderLevel ? { reorderLevel: Number(f.reorderLevel) } : {}),
      isActive: f.isActive !== '0',
    };
    if (!body.categoryId) {
      onError('Select a product category.');
      return;
    }
    if (f.__isNew === '1') await run(() => apiFetch('/inventory/products', { method: 'POST', body: JSON.stringify(body) }), 'Product created.', onNotice, onError);
    else if (f.__id) await run(() => apiFetch(`/inventory/products/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Product updated.', onNotice, onError);
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this product?')) return;
    await run(() => apiFetch(`/inventory/products/${id}`, { method: 'DELETE' }), 'Product deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Products ({rows.length})</h2>
        {canCreate && <Button onClick={() => setEditor({ __isNew: '1', code: '', name: '', categoryId: productCategories[0]?.id ?? '', sku: '', unit: 'PCS', unitPriceCents: '', reorderLevel: '0', isActive: '1' })}>New product</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No products yet.</p>}
      {rows.length > 0 && (
        <Table head={['Code', 'Name', 'Category', 'Unit', 'Price', 'Reorder', 'Stock lines', 'Status', 'Actions']}>
          {rows.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{p.code}</td>
              <td style={td}>{p.name}</td>
              <td style={td}>{p.category?.name ?? '—'}</td>
              <td style={td}>{p.unit ?? '—'}</td>
              <td style={td}>{fmtCents(p.unitPriceCents)}</td>
              <td style={td}>{p.reorderLevel}</td>
              <td style={td}>{p._count?.stockItems ?? 0}</td>
              <td style={td}>{p.isActive ? 'Active' : 'Inactive'}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor({ __id: p.id, code: p.code, name: p.name, categoryId: p.category?.id ?? '', sku: p.sku ?? '', unit: p.unit ?? 'PCS', unitPriceCents: p.unitPriceCents != null ? String(p.unitPriceCents) : '', reorderLevel: String(p.reorderLevel ?? 0), isActive: p.isActive ? '1' : '0' })}>Edit</Button>}
                {canDelete && <Button variant="secondary" onClick={() => void remove(p.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editor && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{editor.__isNew === '1' ? 'New product' : 'Edit product'}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(canCreate || canUpdate) && <Button onClick={() => void save(editor)}>Save</Button>}
              <Button variant="secondary" onClick={() => setEditor(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input value={editor.code ?? ''} onChange={(e) => setEditor({ ...editor, code: e.target.value })} placeholder="Code" style={{ width: 120 }} />
            <Input value={editor.name ?? ''} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 200 }} />
            <select value={editor.categoryId ?? ''} onChange={(e) => setEditor({ ...editor, categoryId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Select category…</option>
              {productCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Input value={editor.sku ?? ''} onChange={(e) => setEditor({ ...editor, sku: e.target.value })} placeholder="SKU" style={{ width: 140 }} />
            <Input value={editor.unit ?? ''} onChange={(e) => setEditor({ ...editor, unit: e.target.value })} placeholder="Unit" style={{ width: 100 }} />
            <Input value={editor.unitPriceCents ?? ''} onChange={(e) => setEditor({ ...editor, unitPriceCents: e.target.value })} placeholder="Price (paise)" type="number" style={{ width: 150 }} />
            <Input value={editor.reorderLevel ?? ''} onChange={(e) => setEditor({ ...editor, reorderLevel: e.target.value })} placeholder="Reorder level" type="number" style={{ width: 140 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

// ── Locations ───────────────────────────────────────────────────────────────

function LocationsTab({ lookups, canCreate, canUpdate, canDelete, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<LocationRow>('/inventory/locations?take=100');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);

  const save = async (f: Record<string, string>) => {
    const body = {
      code: f.code,
      name: f.name,
      type: f.type || 'STORE',
      ...(f.campusId ? { campusId: f.campusId } : {}),
      isActive: f.isActive !== '0',
      ...(f.notes?.trim() ? { notes: f.notes.trim() } : {}),
    };
    if (f.__isNew === '1') await run(() => apiFetch('/inventory/locations', { method: 'POST', body: JSON.stringify(body) }), 'Location created.', onNotice, onError);
    else if (f.__id) await run(() => apiFetch(`/inventory/locations/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Location updated.', onNotice, onError);
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this location?')) return;
    await run(() => apiFetch(`/inventory/locations/${id}`, { method: 'DELETE' }), 'Location deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Locations ({rows.length})</h2>
        {canCreate && <Button onClick={() => setEditor({ __isNew: '1', code: '', name: '', type: 'STORE', campusId: '', isActive: '1', notes: '' })}>New location</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No locations yet.</p>}
      {rows.length > 0 && (
        <Table head={['Code', 'Name', 'Type', 'Campus', 'Stock lines', 'Assets', 'Status', 'Actions']}>
          {rows.map((l) => (
            <tr key={l.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{l.code}</td>
              <td style={td}>{l.name}</td>
              <td style={td}>{l.type}</td>
              <td style={td}>{l.campus?.name ?? '—'}</td>
              <td style={td}>{l._count?.stockItems ?? 0}</td>
              <td style={td}>{l._count?.assets ?? 0}</td>
              <td style={td}>{l.isActive ? 'Active' : 'Inactive'}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor({ __id: l.id, code: l.code, name: l.name, type: l.type, campusId: l.campus?.id ?? '', isActive: l.isActive ? '1' : '0', notes: l.notes ?? '' })}>Edit</Button>}
                {canDelete && <Button variant="secondary" onClick={() => void remove(l.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editor && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{editor.__isNew === '1' ? 'New location' : 'Edit location'}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(canCreate || canUpdate) && <Button onClick={() => void save(editor)}>Save</Button>}
              <Button variant="secondary" onClick={() => setEditor(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input value={editor.code ?? ''} onChange={(e) => setEditor({ ...editor, code: e.target.value })} placeholder="Code" style={{ width: 120 }} />
            <Input value={editor.name ?? ''} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 200 }} />
            <select value={editor.type ?? 'STORE'} onChange={(e) => setEditor({ ...editor, type: e.target.value })} style={{ ...selectStyle, width: 160 }}>
              {(lookups?.locationTypes ?? ['WAREHOUSE', 'STORE', 'LAB', 'ROOM', 'OTHER']).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={editor.campusId ?? ''} onChange={(e) => setEditor({ ...editor, campusId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">No campus</option>
              {(lookups?.campuses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </Card>
      )}
    </Card>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────

function StockTab({ lookups, canCreate, canUpdate, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const [sub, setSub] = useState<'balances' | 'movements' | 'transfers' | 'adjustments'>('balances');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['balances', 'movements', 'transfers', 'adjustments'] as const).map((s) => (
          <Button key={s} variant={sub === s ? 'primary' : 'secondary'} onClick={() => setSub(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
      {sub === 'balances' && <BalancesPanel onError={onError} />}
      {sub === 'movements' && <MovementsPanel onError={onError} />}
      {sub === 'transfers' && <TransfersPanel lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} onError={onError} onNotice={onNotice} />}
      {sub === 'adjustments' && <AdjustmentsPanel lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} onError={onError} onNotice={onNotice} />}
    </>
  );
}

function BalancesPanel({ onError }: { onError: (m: string | null) => void }) {
  const [lowStock, setLowStock] = useState(false);
  const path = `/inventory/stock?take=100${lowStock ? '&lowStock=true' : ''}`;
  const { rows } = usePagedList<StockItemRow>(path);
  useEffect(() => { onError(null); }, [onError]);
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Stock balances ({rows.length})</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
          Low stock only
        </label>
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No stock on hand.</p>}
      {rows.length > 0 && (
        <Table head={['Product', 'Location', 'On hand', 'Unit price', 'Value', 'Reorder']}>
          {rows.map((s) => {
            const low = s.product.reorderLevel > 0 && s.quantityOnHand <= s.product.reorderLevel;
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}>{s.product.name}</td>
                <td style={td}>{s.location.name}</td>
                <td style={{ ...td, color: low ? '#b91c1c' : undefined, fontWeight: low ? 700 : 400 }}>{s.quantityOnHand}</td>
                <td style={td}>{fmtCents(s.product.unitPriceCents)}</td>
                <td style={td}>{fmtCents(s.quantityOnHand * (s.product.unitPriceCents ?? 0))}</td>
                <td style={td}>{s.product.reorderLevel}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

function MovementsPanel({ onError }: { onError: (m: string | null) => void }) {
  const { rows } = usePagedList<StockMovementRow>('/inventory/stock/movements?take=100');
  useEffect(() => { onError(null); }, [onError]);
  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Stock ledger ({rows.length})</h2>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No movements yet.</p>}
      {rows.length > 0 && (
        <Table head={['When', 'Type', 'Product', 'Location', 'Δ', 'Before', 'After', 'Reference']}>
          {rows.map((m) => (
            <tr key={m.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{fmtDate(m.occurredAt)}</td>
              <td style={td}>{m.type}</td>
              <td style={td}>{m.product.name}</td>
              <td style={td}>{m.location.name}</td>
              <td style={{ ...td, color: m.quantityDelta < 0 ? '#b91c1c' : '#15803d' }}>{m.quantityDelta}</td>
              <td style={td}>{m.quantityBefore}</td>
              <td style={td}>{m.quantityAfter}</td>
              <td style={td}>{m.referenceType ?? '—'}{m.reason ? ` · ${m.reason}` : ''}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function TransfersPanel({ lookups, canCreate, canUpdate, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<TransferRow>('/inventory/stock/transfers?take=100');
  const [form, setForm] = useState<{ fromLocationId: string; toLocationId: string; notes: string; productId: string; quantity: string } | null>(null);

  const create = async () => {
    if (!form) return;
    if (!form.fromLocationId || !form.toLocationId || !form.productId) {
      onError('Source, destination and product are required.');
      return;
    }
    await run(
      () =>
        apiFetch('/inventory/stock/transfers', {
          method: 'POST',
          body: JSON.stringify({
            fromLocationId: form.fromLocationId,
            toLocationId: form.toLocationId,
            ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            items: [{ productId: form.productId, quantity: Number(form.quantity) || 1 }],
          }),
        }),
      'Transfer created.',
      onNotice,
      onError,
    );
    setForm(null);
    void load();
  };

  const act = async (id: string, action: 'complete' | 'cancel') => {
    if (!window.confirm(`${action === 'complete' ? 'Complete' : 'Cancel'} this transfer?`)) return;
    await run(() => apiFetch(`/inventory/stock/transfers/${id}/${action}`, { method: 'POST' }), `Transfer ${action}d.`, onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Stock transfers ({rows.length})</h2>
        {canCreate && <Button onClick={() => setForm({ fromLocationId: '', toLocationId: '', notes: '', productId: '', quantity: '1' })}>New transfer</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No transfers yet.</p>}
      {rows.length > 0 && (
        <Table head={['Number', 'From', 'To', 'Items', 'Status', 'Actions']}>
          {rows.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{t.transferNumber}</td>
              <td style={td}>{t.fromLocation.name}</td>
              <td style={td}>{t.toLocation.name}</td>
              <td style={td}>{t.items.map((i) => `${i.product.name} ×${i.quantity}`).join(', ')}</td>
              <td style={td}><StatusBadge status={t.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && t.status === 'PENDING' && (
                  <>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(t.id, 'complete')}>Complete</Button>
                    <Button variant="secondary" onClick={() => void act(t.id, 'cancel')}>Cancel</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>New stock transfer</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void create()}>Create</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={form.fromLocationId} onChange={(e) => setForm({ ...form, fromLocationId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">From location…</option>
              {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={form.toLocationId} onChange={(e) => setForm({ ...form, toLocationId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">To location…</option>
              {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">Product…</option>
              {(lookups?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} type="number" placeholder="Qty" style={{ width: 90 }} />
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" style={{ flex: 1, minWidth: 200 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

function AdjustmentsPanel({ lookups, canCreate, canUpdate, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<AdjustmentRow>('/inventory/stock/adjustments?take=100');
  const [form, setForm] = useState<{ locationId: string; reason: string; description: string; productId: string; quantityDelta: string } | null>(null);

  const create = async () => {
    if (!form) return;
    if (!form.locationId || !form.productId) {
      onError('Location and product are required.');
      return;
    }
    await run(
      () =>
        apiFetch('/inventory/stock/adjustments', {
          method: 'POST',
          body: JSON.stringify({
            locationId: form.locationId,
            ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            items: [{ productId: form.productId, quantityDelta: Number(form.quantityDelta) || 0 }],
          }),
        }),
      'Adjustment created.',
      onNotice,
      onError,
    );
    setForm(null);
    void load();
  };

  const act = async (id: string, action: 'complete' | 'cancel') => {
    if (!window.confirm(`${action === 'complete' ? 'Complete' : 'Cancel'} this adjustment?`)) return;
    await run(() => apiFetch(`/inventory/stock/adjustments/${id}/${action}`, { method: 'POST' }), `Adjustment ${action}d.`, onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Stock adjustments ({rows.length})</h2>
        {canCreate && <Button onClick={() => setForm({ locationId: '', reason: '', description: '', productId: '', quantityDelta: '0' })}>New adjustment</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No adjustments yet.</p>}
      {rows.length > 0 && (
        <Table head={['Number', 'Location', 'Items', 'Reason', 'Status', 'Actions']}>
          {rows.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{a.adjustmentNumber}</td>
              <td style={td}>{a.location.name}</td>
              <td style={td}>{a.items.map((i) => `${i.product.name} ${i.quantityDelta > 0 ? '+' : ''}${i.quantityDelta}`).join(', ')}</td>
              <td style={td}>{a.reason ?? '—'}</td>
              <td style={td}><StatusBadge status={a.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && a.status === 'DRAFT' && (
                  <>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(a.id, 'complete')}>Complete</Button>
                    <Button variant="secondary" onClick={() => void act(a.id, 'cancel')}>Cancel</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>New stock adjustment</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void create()}>Create</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Location…</option>
              {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">Product…</option>
              {(lookups?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input value={form.quantityDelta} onChange={(e) => setForm({ ...form, quantityDelta: e.target.value })} type="number" placeholder="Δ (+/-)" style={{ width: 110 }} />
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason" style={{ flex: 1, minWidth: 160 }} />
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" style={{ flex: 1, minWidth: 160 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

// ── Purchasing ──────────────────────────────────────────────────────────────

function PurchasingTab({ lookups, canCreate, canUpdate, canDelete, canManage, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null; canManage: boolean }) {
  const [sub, setSub] = useState<'requests' | 'orders' | 'receipts'>('requests');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['requests', 'orders', 'receipts'] as const).map((s) => (
          <Button key={s} variant={sub === s ? 'primary' : 'secondary'} onClick={() => setSub(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
      {sub === 'requests' && <RequestsPanel lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} canManage={canManage} onError={onError} onNotice={onNotice} />}
      {sub === 'orders' && <OrdersPanel lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={onError} onNotice={onNotice} />}
      {sub === 'receipts' && <ReceiptsPanel lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} onError={onError} onNotice={onNotice} />}
    </>
  );
}

function RequestsPanel({ lookups, canCreate, canUpdate, canDelete, canManage, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null; canManage: boolean }) {
  const { rows, load } = usePagedList<PurchaseRequestRow>('/inventory/purchase-requests?take=100');
  const [form, setForm] = useState<{ vendorId: string; departmentId: string; productId: string; quantityRequested: string; unitPriceCents: string; notes: string } | null>(null);

  const create = async () => {
    if (!form) return;
    if (!form.productId) {
      onError('Select a product.');
      return;
    }
    await run(
      () =>
        apiFetch('/inventory/purchase-requests', {
          method: 'POST',
          body: JSON.stringify({
            ...(form.vendorId ? { vendorId: form.vendorId } : {}),
            ...(form.departmentId ? { departmentId: form.departmentId } : {}),
            ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            items: [
              {
                productId: form.productId,
                quantityRequested: Number(form.quantityRequested) || 1,
                ...(form.unitPriceCents ? { unitPriceCents: Number(form.unitPriceCents) } : {}),
              },
            ],
          }),
        }),
      'Purchase request created.',
      onNotice,
      onError,
    );
    setForm(null);
    void load();
  };

  const act = async (id: string, action: string, success: string, body?: unknown) => {
    if (!window.confirm(`${success}?`)) return;
    await run(() => apiFetch(`/inventory/purchase-requests/${id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }), success, onNotice, onError);
    void load();
  };

  const convert = async (id: string) => {
    if (!window.confirm('Convert this approved request into a purchase order?')) return;
    await run(() => apiFetch(`/inventory/purchase-orders/from-request/${id}`, { method: 'POST' }), 'Purchase order created.', onNotice, onError);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this purchase request?')) return;
    await run(() => apiFetch(`/inventory/purchase-requests/${id}`, { method: 'DELETE' }), 'Purchase request deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Purchase requests ({rows.length})</h2>
        {canCreate && <Button onClick={() => setForm({ vendorId: '', departmentId: '', productId: '', quantityRequested: '1', unitPriceCents: '', notes: '' })}>New request</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No purchase requests yet.</p>}
      {rows.length > 0 && (
        <Table head={['Number', 'Vendor', 'Department', 'Items', 'Status', 'Actions']}>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{r.requestNumber}</td>
              <td style={td}>{r.vendor?.name ?? '—'}</td>
              <td style={td}>{r.department?.name ?? '—'}</td>
              <td style={td}>{r.items.map((i) => `${i.product.name} ×${i.quantityRequested}`).join(', ')}</td>
              <td style={td}><StatusBadge status={r.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && ['DRAFT'].includes(r.status) && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(r.id, 'submit', 'Submit request')}>Submit</Button>}
                {canManage && r.status === 'PENDING_APPROVAL' && (
                  <>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(r.id, 'approve', 'Approve request')}>Approve</Button>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(r.id, 'reject', 'Reject request', { reason: window.prompt('Rejection reason?') ?? undefined })}>Reject</Button>
                  </>
                )}
                {canManage && r.status === 'APPROVED' && <Button style={{ marginRight: 6 }} onClick={() => void convert(r.id)}>Convert to PO</Button>}
                {canUpdate && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(r.status) && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(r.id, 'cancel', 'Cancel request')}>Cancel</Button>}
                {canDelete && r.status === 'DRAFT' && <Button variant="secondary" onClick={() => void remove(r.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>New purchase request</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void create()}>Create</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Vendor (optional)…</option>
              {(lookups?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Department (optional)…</option>
              {(lookups?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">Product…</option>
              {(lookups?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input value={form.quantityRequested} onChange={(e) => setForm({ ...form, quantityRequested: e.target.value })} type="number" placeholder="Qty" style={{ width: 90 }} />
            <Input value={form.unitPriceCents} onChange={(e) => setForm({ ...form, unitPriceCents: e.target.value })} type="number" placeholder="Unit price (paise)" style={{ width: 170 }} />
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" style={{ flex: 1, minWidth: 180 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

function OrdersPanel({ lookups, canCreate, canUpdate, canManage, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null; canManage: boolean }) {
  const { rows, load } = usePagedList<PurchaseOrderRow>('/inventory/purchase-orders?take=100');
  const [form, setForm] = useState<{ vendorId: string; productId: string; quantityOrdered: string; unitPriceCents: string; notes: string } | null>(null);

  const create = async () => {
    if (!form) return;
    if (!form.vendorId || !form.productId) {
      onError('Vendor and product are required.');
      return;
    }
    await run(
      () =>
        apiFetch('/inventory/purchase-orders', {
          method: 'POST',
          body: JSON.stringify({
            vendorId: form.vendorId,
            ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
            items: [{ productId: form.productId, quantityOrdered: Number(form.quantityOrdered) || 1, ...(form.unitPriceCents ? { unitPriceCents: Number(form.unitPriceCents) } : {}) }],
          }),
        }),
      'Purchase order created.',
      onNotice,
      onError,
    );
    setForm(null);
    void load();
  };

  const act = async (id: string, action: 'issue' | 'cancel') => {
    if (!window.confirm(`${action === 'issue' ? 'Issue' : 'Cancel'} this purchase order?`)) return;
    await run(() => apiFetch(`/inventory/purchase-orders/${id}/${action}`, { method: 'POST' }), `Purchase order ${action}d.`, onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Purchase orders ({rows.length})</h2>
        {canCreate && <Button onClick={() => setForm({ vendorId: '', productId: '', quantityOrdered: '1', unitPriceCents: '', notes: '' })}>New order</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No purchase orders yet.</p>}
      {rows.length > 0 && (
        <Table head={['Number', 'Vendor', 'Items', 'Total', 'Status', 'Actions']}>
          {rows.map((o) => (
            <tr key={o.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{o.poNumber}</td>
              <td style={td}>{o.vendor?.name ?? '—'}</td>
              <td style={td}>{o.items.map((i) => `${i.product.name} ×${i.quantityOrdered}`).join(', ')}</td>
              <td style={td}>{fmtCents(o.totalCents)}</td>
              <td style={td}><StatusBadge status={o.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canManage && o.status === 'DRAFT' && <Button style={{ marginRight: 6 }} onClick={() => void act(o.id, 'issue')}>Issue</Button>}
                {canUpdate && ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(o.status) && <Button variant="secondary" onClick={() => void act(o.id, 'cancel')}>Cancel</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>New purchase order</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void create()}>Create</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Vendor…</option>
              {(lookups?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">Product…</option>
              {(lookups?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input value={form.quantityOrdered} onChange={(e) => setForm({ ...form, quantityOrdered: e.target.value })} type="number" placeholder="Qty" style={{ width: 90 }} />
            <Input value={form.unitPriceCents} onChange={(e) => setForm({ ...form, unitPriceCents: e.target.value })} type="number" placeholder="Unit price (paise)" style={{ width: 170 }} />
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" style={{ flex: 1, minWidth: 180 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

function ReceiptsPanel({ lookups, canCreate, canUpdate, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<GoodsReceiptRow>('/inventory/goods-receipts?take=100');
  const [form, setForm] = useState<{ vendorId: string; poId: string; productId: string; locationId: string; quantityReceived: string; unitPriceCents: string } | null>(null);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);

  useEffect(() => {
    apiFetch<Paged<PurchaseOrderRow>>('/inventory/purchase-orders?take=100')
      .then((res) => setOrders(res.items.filter((o) => ['ISSUED', 'PARTIALLY_RECEIVED'].includes(o.status))))
      .catch(() => setOrders([]));
  }, []);

  const selectedOrder = orders.find((o) => o.id === form?.poId);

  const create = async () => {
    if (!form) return;
    if (!form.vendorId || !form.productId || !form.locationId) {
      onError('Vendor, product and location are required.');
      return;
    }
    const poItem = selectedOrder?.items.find((i) => i.product.id === form.productId);
    await run(
      () =>
        apiFetch('/inventory/goods-receipts', {
          method: 'POST',
          body: JSON.stringify({
            vendorId: form.vendorId,
            ...(form.poId ? { poId: form.poId } : {}),
            items: [
              {
                productId: form.productId,
                locationId: form.locationId,
                quantityReceived: Number(form.quantityReceived) || 1,
                ...(form.unitPriceCents ? { unitPriceCents: Number(form.unitPriceCents) } : {}),
                ...(form.poId && poItem ? { poItemId: poItem.id } : {}),
              },
            ],
          }),
        }),
      'Goods receipt created.',
      onNotice,
      onError,
    );
    setForm(null);
    void load();
  };

  const act = async (id: string, action: 'complete' | 'cancel') => {
    if (!window.confirm(`${action === 'complete' ? 'Complete' : 'Cancel'} this goods receipt?`)) return;
    await run(() => apiFetch(`/inventory/goods-receipts/${id}/${action}`, { method: 'POST' }), `Goods receipt ${action}d.`, onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Goods receipts ({rows.length})</h2>
        {canCreate && <Button onClick={() => setForm({ vendorId: '', poId: '', productId: '', locationId: '', quantityReceived: '1', unitPriceCents: '' })}>New receipt</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No goods receipts yet.</p>}
      {rows.length > 0 && (
        <Table head={['Number', 'Vendor', 'PO', 'Lines', 'Status', 'Actions']}>
          {rows.map((g) => (
            <tr key={g.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{g.grnNumber}</td>
              <td style={td}>{g.vendor?.name ?? '—'}</td>
              <td style={td}>{g.po?.poNumber ?? '—'}</td>
              <td style={td}>{g._count?.items ?? 0}</td>
              <td style={td}><StatusBadge status={g.status} /></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canUpdate && g.status === 'DRAFT' && (
                  <>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void act(g.id, 'complete')}>Complete</Button>
                    <Button variant="secondary" onClick={() => void act(g.id, 'cancel')}>Cancel</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>New goods receipt</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void create()}>Create</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={form.poId} onChange={(e) => setForm({ ...form, poId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">No purchase order</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.poNumber} — {o.vendor.name}</option>)}
            </select>
            <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Vendor…</option>
              {(lookups?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              <option value="">Product…</option>
              {(selectedOrder ? selectedOrder.items.map((i) => i.product) : lookups?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Location…</option>
              {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <Input value={form.quantityReceived} onChange={(e) => setForm({ ...form, quantityReceived: e.target.value })} type="number" placeholder="Qty" style={{ width: 90 }} />
            <Input value={form.unitPriceCents} onChange={(e) => setForm({ ...form, unitPriceCents: e.target.value })} type="number" placeholder="Unit price (paise)" style={{ width: 170 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

// ── Assets ──────────────────────────────────────────────────────────────────

function AssetsTab({ lookups, canCreate, canUpdate, canDelete, onError, onNotice }: PanelProps & { lookups: LookupsPayload | null }) {
  const { rows, load } = usePagedList<AssetRow>('/inventory/assets?take=100');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [detail, setDetail] = useState<AssetRow | null>(null);
  const assetCategories = (lookups?.categories ?? []).filter((c) => c.kind === 'ASSET');

  const openDetail = async (id: string) => {
    try {
      setDetail(await apiFetch<AssetRow>(`/inventory/assets/${id}`));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load asset.');
    }
  };

  const save = async (f: Record<string, string>) => {
    const body = {
      name: f.name,
      categoryId: f.categoryId,
      ...(f.assetCode?.trim() ? { assetCode: f.assetCode.trim() } : {}),
      ...(f.serialNumber?.trim() ? { serialNumber: f.serialNumber.trim() } : {}),
      ...(f.vendorId ? { vendorId: f.vendorId } : {}),
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.purchaseDate ? { purchaseDate: f.purchaseDate } : {}),
      ...(f.purchaseCostCents ? { purchaseCostCents: Number(f.purchaseCostCents) } : {}),
      ...(f.usefulLifeMonths ? { usefulLifeMonths: Number(f.usefulLifeMonths) } : {}),
      depreciationMethod: f.depreciationMethod || 'NONE',
      condition: f.condition || 'NEW',
    };
    if (!body.categoryId) {
      onError('Select an asset category.');
      return;
    }
    if (f.__isNew === '1') await run(() => apiFetch('/inventory/assets', { method: 'POST', body: JSON.stringify(body) }), 'Asset created.', onNotice, onError);
    else if (f.__id) await run(() => apiFetch(`/inventory/assets/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Asset updated.', onNotice, onError);
    setForm(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this asset?')) return;
    await run(() => apiFetch(`/inventory/assets/${id}`, { method: 'DELETE' }), 'Asset deleted.', onNotice, onError);
    void load();
  };

  const runDepreciation = async () => {
    if (!window.confirm('Run straight-line depreciation for all eligible assets up to today?')) return;
    await run(() => apiFetch('/inventory/assets/depreciation/run', { method: 'POST', body: JSON.stringify({}) }), 'Depreciation run complete.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Assets ({rows.length})</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canUpdate && <Button variant="secondary" onClick={() => void runDepreciation()}>Run depreciation</Button>}
          {canCreate && <Button onClick={() => setForm({ __isNew: '1', name: '', categoryId: assetCategories[0]?.id ?? '', assetCode: '', serialNumber: '', vendorId: '', locationId: '', purchaseDate: '', purchaseCostCents: '', usefulLifeMonths: '', depreciationMethod: 'NONE', condition: 'NEW' })}>New asset</Button>}
        </div>
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No assets yet.</p>}
      {rows.length > 0 && (
        <Table head={['Code', 'Tag', 'Name', 'Category', 'Location', 'Status', 'Book value', 'Actions']}>
          {rows.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={td}>{a.assetCode}</td>
              <td style={td}>{a.tagNumber}</td>
              <td style={td}>{a.name}</td>
              <td style={td}>{a.category?.name ?? '—'}</td>
              <td style={td}>{a.location?.name ?? '—'}</td>
              <td style={td}><StatusBadge status={a.status} /></td>
              <td style={td}>{fmtCents(a.currentBookValueCents)}</td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void openDetail(a.id)}>Open</Button>
                {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setForm({ __id: a.id, name: a.name, categoryId: a.category?.id ?? '', assetCode: a.assetCode, serialNumber: a.serialNumber ?? '', vendorId: a.vendor?.id ?? '', locationId: a.location?.id ?? '', purchaseDate: a.purchaseDate ? a.purchaseDate.slice(0, 10) : '', purchaseCostCents: a.purchaseCostCents != null ? String(a.purchaseCostCents) : '', usefulLifeMonths: a.usefulLifeMonths != null ? String(a.usefulLifeMonths) : '', depreciationMethod: a.depreciationMethod, condition: a.condition })}>Edit</Button>}
                {canDelete && <Button variant="secondary" onClick={() => void remove(a.id)}>Delete</Button>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {form && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{form.__isNew === '1' ? 'New asset' : 'Edit asset'}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(canCreate || canUpdate) && <Button onClick={() => void save(form)}>Save</Button>}
              <Button variant="secondary" onClick={() => setForm(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 200 }} />
            <select value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={{ ...selectStyle, width: 200 }}>
              <option value="">Asset category…</option>
              {assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Input value={form.assetCode ?? ''} onChange={(e) => setForm({ ...form, assetCode: e.target.value })} placeholder="Asset code (auto)" style={{ width: 160 }} />
            <Input value={form.serialNumber ?? ''} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="Serial no." style={{ width: 160 }} />
            <select value={form.vendorId ?? ''} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} style={{ ...selectStyle, width: 180 }}>
              <option value="">Vendor (optional)</option>
              {(lookups?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={form.locationId ?? ''} onChange={(e) => setForm({ ...form, locationId: e.target.value })} style={{ ...selectStyle, width: 180 }}>
              <option value="">Location (optional)</option>
              {(lookups?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <Input value={form.purchaseDate ?? ''} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} type="date" placeholder="Purchase date" style={{ width: 150 }} />
            <Input value={form.purchaseCostCents ?? ''} onChange={(e) => setForm({ ...form, purchaseCostCents: e.target.value })} type="number" placeholder="Cost (paise)" style={{ width: 150 }} />
            <Input value={form.usefulLifeMonths ?? ''} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} type="number" placeholder="Life (months)" style={{ width: 140 }} />
            <select value={form.depreciationMethod ?? 'NONE'} onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value })} style={{ ...selectStyle, width: 180 }}>
              {(lookups?.depreciationMethods ?? ['NONE', 'STRAIGHT_LINE']).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={form.condition ?? 'NEW'} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...selectStyle, width: 140 }}>
              {(lookups?.assetConditions ?? ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'DISPOSED']).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Card>
      )}
      {detail && (
        <AssetDetail
          asset={detail}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onError={onError}
          onNotice={onNotice}
          onClose={() => setDetail(null)}
          onChanged={() => { void openDetail(detail.id); void load(); }}
        />
      )}
    </Card>
  );
}

function AssetDetail({
  asset,
  canCreate,
  canUpdate,
  onError,
  onNotice,
  onClose,
  onChanged,
}: {
  asset: AssetRow;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const activeAssignment = (asset.assignments ?? []).find((a) => a.status === 'ACTIVE');

  const assign = async () => {
    const employeeId = window.prompt('Employee ID to assign (or leave blank for department/other):') ?? '';
    const assigneeType = employeeId ? 'EMPLOYEE' : 'OTHER';
    await run(
      () => apiFetch(`/inventory/assets/${asset.id}/assign`, { method: 'POST', body: JSON.stringify({ assigneeType, ...(employeeId ? { employeeId } : {}) }) }),
      'Asset assigned.',
      onNotice,
      onError,
    );
    onChanged();
  };

  const returnAsset = async () => {
    if (!window.confirm('Return this asset?')) return;
    await run(() => apiFetch(`/inventory/assets/${asset.id}/return`, { method: 'POST', body: JSON.stringify({}) }), 'Asset returned.', onNotice, onError);
    onChanged();
  };

  const addMaintenance = async () => {
    const description = window.prompt('Maintenance description?');
    if (!description) return;
    await run(() => apiFetch(`/inventory/assets/${asset.id}/maintenance`, { method: 'POST', body: JSON.stringify({ type: 'PREVENTIVE', description }) }), 'Maintenance scheduled.', onNotice, onError);
    onChanged();
  };

  const addWarranty = async () => {
    const description = window.prompt('Warranty claim description?');
    if (!description) return;
    await run(() => apiFetch(`/inventory/assets/${asset.id}/warranty-claims`, { method: 'POST', body: JSON.stringify({ description }) }), 'Warranty claim opened.', onNotice, onError);
    onChanged();
  };

  const addDisposal = async () => {
    const type = window.prompt('Disposal type (SALE / SCRAP / DONATION / RETURN_TO_VENDOR)?', 'SCRAP');
    if (!type) return;
    await run(() => apiFetch(`/inventory/assets/${asset.id}/disposals`, { method: 'POST', body: JSON.stringify({ type }) }), 'Disposal drafted.', onNotice, onError);
    onChanged();
  };

  const setMaintenanceStatus = async (id: string, status: string) => {
    await run(() => apiFetch(`/inventory/assets/maintenance/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }), `Maintenance ${status}.`, onNotice, onError);
    onChanged();
  };

  const completeDisposal = async (id: string) => {
    if (!window.confirm('Complete this disposal? The asset will be marked DISPOSED.')) return;
    await run(() => apiFetch(`/inventory/assets/disposals/${id}/complete`, { method: 'POST', body: JSON.stringify({}) }), 'Disposal completed.', onNotice, onError);
    onChanged();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{asset.name} — {asset.assetCode}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canUpdate && !activeAssignment && <Button onClick={() => void assign()}>Assign</Button>}
          {canUpdate && activeAssignment && <Button variant="secondary" onClick={() => void returnAsset()}>Return</Button>}
          {canCreate && <Button variant="secondary" onClick={() => void addMaintenance()}>Schedule maintenance</Button>}
          {canCreate && <Button variant="secondary" onClick={() => void addWarranty()}>Warranty claim</Button>}
          {canCreate && <Button variant="secondary" onClick={() => void addDisposal()}>Dispose</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, fontSize: '0.9rem', marginBottom: 12 }}>
        <div><strong>Status:</strong> <StatusBadge status={asset.status} /></div>
        <div><strong>Condition:</strong> {asset.condition}</div>
        <div><strong>Category:</strong> {asset.category?.name ?? '—'}</div>
        <div><strong>Location:</strong> {asset.location?.name ?? '—'}</div>
        <div><strong>Cost:</strong> {fmtCents(asset.purchaseCostCents)}</div>
        <div><strong>Book value:</strong> {fmtCents(asset.currentBookValueCents)}</div>
        <div><strong>Method:</strong> {asset.depreciationMethod}</div>
        <div><strong>Warranty ends:</strong> {asset.warrantyEndDate ? fmtDate(asset.warrantyEndDate) : '—'}</div>
      </div>

      {activeAssignment && (
        <p style={{ fontSize: '0.9rem', color: '#374151' }}>
          Assigned to: {activeAssignment.employee ? `${activeAssignment.employee.firstName} ${activeAssignment.employee.lastName ?? ''}` : activeAssignment.department?.name ?? activeAssignment.campus?.name ?? activeAssignment.assigneeName ?? activeAssignment.assigneeType} since {fmtDate(activeAssignment.assignedAt)}
        </p>
      )}

      {(asset.maintenanceRecords ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Maintenance</h3>
          <Table head={['Number', 'Type', 'Status', 'Scheduled', 'Actions']}>
            {(asset.maintenanceRecords ?? []).map((m: MaintenanceRow) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{m.maintenanceNumber}</td>
                <td style={td}>{m.type}</td>
                <td style={td}><StatusBadge status={m.status} /></td>
                <td style={td}>{m.scheduledDate ? fmtDate(m.scheduledDate) : '—'}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && m.status === 'SCHEDULED' && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void setMaintenanceStatus(m.id, 'IN_PROGRESS')}>Start</Button>}
                  {canUpdate && m.status === 'IN_PROGRESS' && <Button variant="secondary" onClick={() => void setMaintenanceStatus(m.id, 'COMPLETED')}>Complete</Button>}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {(asset.warrantyClaims ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Warranty claims</h3>
          <Table head={['Number', 'Description', 'Status', 'Opened']}>
            {(asset.warrantyClaims ?? []).map((w: WarrantyClaimRow) => (
              <tr key={w.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{w.claimNumber}</td>
                <td style={td}>{w.description}</td>
                <td style={td}><StatusBadge status={w.status} /></td>
                <td style={td}>{fmtDate(w.openedAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {(asset.depreciationEntries ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Depreciation</h3>
          <Table head={['Period', 'Opening', 'Depreciation', 'Closing']}>
            {(asset.depreciationEntries ?? []).slice(0, 12).map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{fmtDate(d.periodStart)}</td>
                <td style={td}>{fmtCents(d.openingBookValueCents)}</td>
                <td style={td}>{fmtCents(d.depreciationCents)}</td>
                <td style={td}>{fmtCents(d.closingBookValueCents)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {(asset.disposals ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Disposals</h3>
          <Table head={['Number', 'Type', 'Status', 'Proceeds', 'Actions']}>
            {(asset.disposals ?? []).map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{d.disposalNumber}</td>
                <td style={td}>{d.type}</td>
                <td style={td}><StatusBadge status={d.status} /></td>
                <td style={td}>{fmtCents(d.proceedsCents)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {canUpdate && d.status === 'DRAFT' && <Button variant="secondary" onClick={() => void completeDisposal(d.id)}>Complete</Button>}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

// ── Shared inline editor ────────────────────────────────────────────────────

interface PanelProps {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete?: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}

function InlineEditor({
  title,
  value,
  onChange,
  onSave,
  canSave,
  onClose,
  fields,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onSave: () => void;
  canSave: boolean;
  onClose: () => void;
  fields: { key: string; placeholder: string; width?: number; flex?: boolean }[];
}) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSave && <Button onClick={onSave}>Save</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {fields.map((f) => (
          <Input
            key={f.key}
            value={value[f.key] ?? ''}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            style={f.flex ? { flex: 1, minWidth: 180 } : { width: f.width ?? 140 }}
          />
        ))}
      </div>
    </Card>
  );
}
