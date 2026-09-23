import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  BookRow,
  CategoryRow,
  CopyBarcodePayload,
  CopyRow,
  CirculationReport,
  InventoryReport,
  LIBRARY_BARCODE_ENTITLEMENT,
  LIBRARY_CREATE_PERMISSION,
  LIBRARY_DELETE_PERMISSION,
  LIBRARY_MANAGE_PERMISSION,
  LIBRARY_UPDATE_PERMISSION,
  LIBRARY_VIEW_PERMISSION,
  LibraryConfig,
  LibrarySummary,
  LookupsPayload,
  MemberRow,
  Paged,
  PublisherRow,
  ReservationRow,
  AuthorRow,
  FineRow,
  LoanRow,
  TransactionRow,
} from './library-shared';

export function LibraryPage() {
  const { permissions, entitlements } = useAuth();
  const [tab, setTab] = useState<'summary' | 'catalog' | 'copies' | 'members' | 'circulation' | 'reservations' | 'fines' | 'config'>('summary');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canView = permissions.includes(LIBRARY_VIEW_PERMISSION);
  const canCreate = permissions.includes(LIBRARY_CREATE_PERMISSION);
  const canUpdate = permissions.includes(LIBRARY_UPDATE_PERMISSION);
  const canDelete = permissions.includes(LIBRARY_DELETE_PERMISSION);
  const canManage = permissions.includes(LIBRARY_MANAGE_PERMISSION);
  const canBarcode = canView && Boolean(entitlements[LIBRARY_BARCODE_ENTITLEMENT]);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view the library module.</p>;
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'catalog', label: 'Catalog' },
    { key: 'copies', label: 'Copies' },
    { key: 'members', label: 'Members' },
    { key: 'circulation', label: 'Circulation' },
    { key: 'reservations', label: 'Reservations' },
    { key: 'fines', label: 'Fines' },
    { key: 'config', label: 'Config' },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Library</h1>
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
      {tab === 'catalog' && <CatalogTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'copies' && <CopiesTab canCreate={canCreate} canUpdate={canUpdate} canBarcode={canBarcode} onError={setError} onNotice={setNotice} />}
      {tab === 'members' && <MembersTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'circulation' && <CirculationTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'reservations' && <ReservationsTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'fines' && <FinesTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'config' && <ConfigTab canManage={canManage} onError={setError} onNotice={setNotice} />}
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

// ── Summary ─────────────────────────────────────────────────────────────────

function SummaryTab({ onError }: { onError: (msg: string | null) => void }) {
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [circulation, setCirculation] = useState<CirculationReport | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      const [s, c, i] = await Promise.all([
        apiFetch<LibrarySummary>('/library/reports/summary'),
        apiFetch<CirculationReport>('/library/reports/circulation?days=30&limit=10'),
        apiFetch<InventoryReport>('/library/reports/inventory'),
      ]);
      setSummary(s);
      setCirculation(c);
      setInventory(i);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load library summary.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return null;

  const cards: { label: string; value: string; color?: string }[] = [
    { label: 'Books', value: String(summary.totalBooks) },
    { label: 'Copies', value: String(summary.totalCopies) },
    { label: 'Available', value: String(summary.availableCopies), color: '#15803d' },
    { label: 'Issued', value: String(summary.issuedCopies), color: '#3b82f6' },
    { label: 'Overdue', value: String(summary.overdueLoans), color: '#b91c1c' },
    { label: 'Reserved', value: String(summary.reservedCopies), color: '#8b5cf6' },
    { label: 'Damaged', value: String(summary.damagedCopies), color: '#f59e0b' },
    { label: 'Lost', value: String(summary.lostCopies), color: '#6b7280' },
    { label: 'Active members', value: String(summary.activeMembers) },
    { label: 'Waiting holds', value: String(summary.waitingReservations) },
    { label: 'Pending fines', value: fmtCents(summary.pendingFinesCents), color: summary.pendingFinesCents > 0 ? '#b91c1c' : '#15803d' },
    { label: 'Issued today', value: String(summary.todayIssued) },
    { label: 'Returned today', value: String(summary.todayReturned) },
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

      {circulation && circulation.topBooks.length > 0 && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Top books (last {circulation.days} days)</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>#</th>
                <th style={{ padding: 8 }}>Book</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Issues</th>
              </tr>
            </thead>
            <tbody>
              {circulation.topBooks.map((b, i) => (
                <tr key={b.bookId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{i + 1}</td>
                  <td style={{ padding: 8 }}>{b.title}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{b.issues}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {inventory && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Copies by status</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <tbody>
                {Object.entries(inventory.byStatus).map(([status, count]) => (
                  <tr key={status} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>{status}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card style={{ flex: 1, minWidth: 280 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Copies by category</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 8 }}>Category</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Books</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Copies</th>
                </tr>
              </thead>
              <tbody>
                {inventory.byCategory.map((c) => (
                  <tr key={c.categoryId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>{c.categoryName}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{c.books}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{c.copies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}

// ── Catalog ─────────────────────────────────────────────────────────────────

function CatalogTab({
  canCreate,
  canUpdate,
  canDelete,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [sub, setSub] = useState<'categories' | 'publishers' | 'authors' | 'books'>('books');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        {(['books', 'categories', 'publishers', 'authors'] as const).map((s) => (
          <Button key={s} variant={sub === s ? 'primary' : 'secondary'} onClick={() => setSub(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
      {sub === 'categories' && <CategoriesPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={onError} onNotice={onNotice} />}
      {sub === 'publishers' && <PublishersPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={onError} onNotice={onNotice} />}
      {sub === 'authors' && <AuthorsPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={onError} onNotice={onNotice} />}
      {sub === 'books' && <BooksPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={onError} onNotice={onNotice} />}
    </>
  );
}

interface EditorState {
  isNew: boolean;
  id?: string;
  code: string;
  name: string;
  description?: string;
  parentId?: string;
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

function CategoriesPanel({ canCreate, canUpdate, canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const { rows, load } = useSimpleList<CategoryRow>('/library/categories');
  const [editor, setEditor] = useState<EditorState | null>(null);

  const openNew = (): EditorState => ({ isNew: true, code: '', name: '', description: '', parentId: '' });
  const openEdit = (r: CategoryRow): EditorState => ({ isNew: false, id: r.id, code: r.code, name: r.name, description: r.description ?? '', parentId: r.parentId ?? '' });

  const save = async (f: EditorState) => {
    const body = {
      code: f.code.trim(),
      name: f.name.trim(),
      ...(f.description?.trim() ? { description: f.description.trim() } : {}),
      ...(f.parentId ? { parentId: f.parentId } : {}),
    };
    if (f.isNew) {
      await run(() => apiFetch('/library/categories', { method: 'POST', body: JSON.stringify(body) }), 'Category created.', onNotice, onError);
    } else if (f.id) {
      await run(() => apiFetch(`/library/categories/${f.id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Category updated.', onNotice, onError);
    }
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this category? Books keep their category via soft-archive; this removes the catalog entry.')) return;
    await run(() => apiFetch(`/library/categories/${id}`, { method: 'DELETE' }), 'Category deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Categories</h2>
        {canCreate && <Button onClick={() => setEditor(openNew())}>New category</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No categories yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Code</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Books</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{c.code}</td>
                <td style={{ padding: 8 }}>{c.name}</td>
                <td style={{ padding: 8 }}>{c._count?.books ?? 0}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor(openEdit(c))}>Edit</Button>}
                  {canDelete && <Button variant="secondary" onClick={() => void remove(c.id)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editor && (
        <SimpleEditor
          title={editor.isNew ? 'New category' : 'Edit category'}
          fields={[
            { key: 'code', label: 'Code', value: editor.code, width: 140 },
            { key: 'name', label: 'Name', value: editor.name, flex: true },
          ]}
          value={editor}
          onChange={(patch) => setEditor((cur) => (cur ? { ...cur, ...patch } : cur))}
          onSave={() => void save(editor)}
          canSave={canCreate || canUpdate}
          onClose={() => setEditor(null)}
        />
      )}
    </Card>
  );
}

function PublishersPanel({ canCreate, canUpdate, canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const { rows, load } = useSimpleList<PublisherRow>('/library/publishers');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);

  const save = async (f: Record<string, string>) => {
    const body = {
      code: f.code,
      name: f.name,
      ...(f.city?.trim() ? { city: f.city.trim() } : {}),
      ...(f.country?.trim() ? { country: f.country.trim() } : {}),
      ...(f.website?.trim() ? { website: f.website.trim() } : {}),
    };
    if (f.__isNew === '1') {
      await run(() => apiFetch('/library/publishers', { method: 'POST', body: JSON.stringify(body) }), 'Publisher created.', onNotice, onError);
    } else if (f.__id) {
      await run(() => apiFetch(`/library/publishers/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Publisher updated.', onNotice, onError);
    }
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this publisher?')) return;
    await run(() => apiFetch(`/library/publishers/${id}`, { method: 'DELETE' }), 'Publisher deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Publishers</h2>
        {canCreate && (
          <Button
            onClick={() => setEditor({ __isNew: '1', code: '', name: '', city: '', country: 'India', website: '' })}
          >
            New publisher
          </Button>
        )}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No publishers yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Code</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>City</th>
              <th style={{ padding: 8 }}>Books</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{p.code}</td>
                <td style={{ padding: 8 }}>{p.name}</td>
                <td style={{ padding: 8 }}>{p.city ?? '—'}</td>
                <td style={{ padding: 8 }}>{p._count?.books ?? 0}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      style={{ marginRight: 6 }}
                      onClick={() =>
                        setEditor({ __id: p.id, code: p.code, name: p.name, city: p.city ?? '', country: p.country ?? 'India', website: p.website ?? '' })
                      }
                    >
                      Edit
                    </Button>
                  )}
                  {canDelete && <Button variant="secondary" onClick={() => void remove(p.id)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editor && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{editor.__isNew === '1' ? 'New publisher' : 'Edit publisher'}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(canCreate || canUpdate) && <Button onClick={() => void save(editor)}>Save</Button>}
              <Button variant="secondary" onClick={() => setEditor(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input value={editor.code ?? ''} onChange={(e) => setEditor({ ...editor, code: e.target.value })} placeholder="Code" style={{ width: 140 }} />
            <Input value={editor.name ?? ''} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
            <Input value={editor.city ?? ''} onChange={(e) => setEditor({ ...editor, city: e.target.value })} placeholder="City" style={{ width: 160 }} />
            <Input value={editor.country ?? ''} onChange={(e) => setEditor({ ...editor, country: e.target.value })} placeholder="Country" style={{ width: 140 }} />
            <Input value={editor.website ?? ''} onChange={(e) => setEditor({ ...editor, website: e.target.value })} placeholder="Website" style={{ flex: 1, minWidth: 180 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

function AuthorsPanel({ canCreate, canUpdate, canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const { rows, load } = useSimpleList<AuthorRow>('/library/authors');
  const [editor, setEditor] = useState<Record<string, string> | null>(null);

  const save = async (f: Record<string, string>) => {
    const body = {
      code: f.code,
      firstName: f.firstName,
      ...(f.lastName?.trim() ? { lastName: f.lastName.trim() } : {}),
      ...(f.bio?.trim() ? { bio: f.bio.trim() } : {}),
    };
    if (f.__isNew === '1') {
      await run(() => apiFetch('/library/authors', { method: 'POST', body: JSON.stringify(body) }), 'Author created.', onNotice, onError);
    } else if (f.__id) {
      await run(() => apiFetch(`/library/authors/${f.__id}`, { method: 'PATCH', body: JSON.stringify(body) }), 'Author updated.', onNotice, onError);
    }
    setEditor(null);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this author?')) return;
    await run(() => apiFetch(`/library/authors/${id}`, { method: 'DELETE' }), 'Author deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Authors</h2>
        {canCreate && <Button onClick={() => setEditor({ __isNew: '1', code: '', firstName: '', lastName: '', bio: '' })}>New author</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No authors yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Code</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Books</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{a.code}</td>
                <td style={{ padding: 8 }}>{a.fullName}</td>
                <td style={{ padding: 8 }}>{a._count?.bookLinks ?? 0}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      style={{ marginRight: 6 }}
                      onClick={() => setEditor({ __id: a.id, code: a.code, firstName: a.firstName, lastName: a.lastName ?? '', bio: a.bio ?? '' })}
                    >
                      Edit
                    </Button>
                  )}
                  {canDelete && <Button variant="secondary" onClick={() => void remove(a.id)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editor && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{editor.__isNew === '1' ? 'New author' : 'Edit author'}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(canCreate || canUpdate) && <Button onClick={() => void save(editor)}>Save</Button>}
              <Button variant="secondary" onClick={() => setEditor(null)}>Close</Button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input value={editor.code ?? ''} onChange={(e) => setEditor({ ...editor, code: e.target.value })} placeholder="Code" style={{ width: 140 }} />
            <Input value={editor.firstName ?? ''} onChange={(e) => setEditor({ ...editor, firstName: e.target.value })} placeholder="First name" style={{ flex: 1, minWidth: 160 }} />
            <Input value={editor.lastName ?? ''} onChange={(e) => setEditor({ ...editor, lastName: e.target.value })} placeholder="Last name" style={{ flex: 1, minWidth: 160 }} />
            <Input value={editor.bio ?? ''} onChange={(e) => setEditor({ ...editor, bio: e.target.value })} placeholder="Bio" style={{ flex: 2, minWidth: 220 }} />
          </div>
        </Card>
      )}
    </Card>
  );
}

// Reusable minimal inline editor for category-style records.
function SimpleEditor({
  title,
  fields,
  value,
  onChange,
  onSave,
  canSave,
  onClose,
}: {
  title: string;
  fields: { key: string; label: string; value: string; width?: number; flex?: boolean }[];
  value: EditorState;
  onChange: (patch: Partial<EditorState>) => void;
  onSave: () => void;
  canSave: boolean;
  onClose: () => void;
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
            value={String(((value as unknown) as Record<string, string>)[f.key] ?? '')}
            onChange={(e) => onChange({ [f.key]: e.target.value } as Partial<EditorState>)}
            placeholder={f.label}
            style={{ ...(f.flex ? { flex: 1, minWidth: 180 } : { width: f.width ?? 140 }) }}
          />
        ))}
      </div>
    </Card>
  );
}

function BooksPanel({ canCreate, canUpdate, canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<BookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [skip, setSkip] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BookRow | null>(null);
  const [lookups, setLookups] = useState<LookupsPayload | null>(null);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', categoryId);
    params.set('skip', String(skip));
    params.set('take', '25');
    try {
      const res = await apiFetch<Paged<BookRow>>(`/library/books?${params.toString()}`);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load books.');
    }
  }, [search, categoryId, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    apiFetch<LookupsPayload>('/library/lookups')
      .then((res) => {
        if (mounted) setLookups(res);
      })
      .catch(() => {
        if (mounted) setLookups(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm('Archive this book (soft delete)? Copies remain but circulation stops at free copies.')) return;
    await run(() => apiFetch(`/library/books/${id}`, { method: 'DELETE' }), 'Book archived.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Books ({total})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreate && <Button onClick={() => { setEditing(null); setShowForm(true); }}>New book</Button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setSkip(0); }} placeholder="Search title / ISBN" style={{ flex: 1, minWidth: 220 }} />
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSkip(0); }} style={{ ...selectStyle, width: 220 }}>
          <option value="">All categories</option>
          {(lookups?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No books match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>ISBN</th>
              <th style={{ padding: 8 }}>Category</th>
              <th style={{ padding: 8 }}>Authors</th>
              <th style={{ padding: 8 }}>Copies</th>
              <th style={{ padding: 8 }}>Days</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{b.title}</td>
                <td style={{ padding: 8 }}>{b.isbn ?? '—'}</td>
                <td style={{ padding: 8 }}>{b.category.name}</td>
                <td style={{ padding: 8 }}>{b.authors.map((a) => a.author.fullName).join(', ') || '—'}</td>
                <td style={{ padding: 8 }}>{b.copies.length}</td>
                <td style={{ padding: 8 }}>{b.maxLoanDays}</td>
                <td style={{ padding: 8 }}>{b.isActive ? 'Active' : 'Inactive'}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => { setEditing(b); setShowForm(true); }}>Edit</Button>}
                  {canDelete && <Button variant="secondary" onClick={() => void remove(b.id)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 25))}>Prev</Button>
        <Button variant="secondary" disabled={skip + 25 >= total} onClick={() => setSkip((s) => s + 25)}>Next</Button>
      </div>

      {showForm && (
        <BookForm
          row={editing}
          lookups={lookups}
          canSave={canCreate || canUpdate}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onDone={() => { setShowForm(false); setEditing(null); void load(); }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </Card>
  );
}

function BookForm({
  row,
  lookups,
  canSave,
  onClose,
  onDone,
  onError,
  onNotice,
}: {
  row: BookRow | null;
  lookups: LookupsPayload | null;
  canSave: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [f, setF] = useState(() => ({
    title: row?.title ?? '',
    isbn: row?.isbn ?? '',
    categoryId: row?.category.id ?? '',
    publisherId: row?.publisher?.id ?? '',
    authorIds: (row?.authors ?? []).map((a) => a.author.id),
    maxLoanDays: String(row?.maxLoanDays ?? 14),
    replacementCostCents: row?.replacementCostCents != null ? String(row.replacementCostCents) : '',
    isActive: row?.isActive ?? true,
  }));

  const toggleAuthor = (id: string) =>
    setF((cur) => ({ ...cur, authorIds: cur.authorIds.includes(id) ? cur.authorIds.filter((x) => x !== id) : [...cur.authorIds, id] }));

  const save = async () => {
    if (!f.title.trim() || !f.categoryId) {
      onError('Title and category are required.');
      return;
    }
    const body = {
      title: f.title.trim(),
      ...(f.isbn.trim() ? { isbn: f.isbn.trim() } : {}),
      categoryId: f.categoryId,
      ...(f.publisherId ? { publisherId: f.publisherId } : {}),
      authorIds: f.authorIds,
      maxLoanDays: Number(f.maxLoanDays) || 14,
      ...(f.replacementCostCents ? { replacementCostCents: Number(f.replacementCostCents) } : {}),
      isActive: f.isActive,
    };
    try {
      if (row) {
        await apiFetch(`/library/books/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        onNotice('Book updated.');
      } else {
        await apiFetch('/library/books', { method: 'POST', body: JSON.stringify(body) });
        onNotice('Book created.');
      }
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save book.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{row ? `Edit book — ${row.title}` : 'New book'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSave && <Button onClick={() => void save()}>Save</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" style={{ flex: 2, minWidth: 240 }} />
        <Input value={f.isbn} onChange={(e) => setF({ ...f, isbn: e.target.value })} placeholder="ISBN" style={{ width: 160 }} />
        <Input value={f.maxLoanDays} onChange={(e) => setF({ ...f, maxLoanDays: e.target.value })} placeholder="Loan days" type="number" style={{ width: 110 }} />
        <Input value={f.replacementCostCents} onChange={(e) => setF({ ...f, replacementCostCents: e.target.value })} placeholder="Replacement (paise)" type="number" style={{ width: 160 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
          <option value="">Select category…</option>
          {(lookups?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={f.publisherId} onChange={(e) => setF({ ...f, publisherId: e.target.value })} style={{ ...selectStyle, width: 220 }}>
          <option value="">No publisher</option>
          {(lookups?.publishers ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      </div>
      <div style={{ fontSize: '0.9rem' }}>
        <strong>Authors:</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {lookups?.authors.map((a) => (
            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={f.authorIds.includes(a.id)} onChange={() => toggleAuthor(a.id)} />
              {a.fullName}
            </label>
          ))}
          {(!lookups || lookups.authors.length === 0) && <span style={{ color: '#9ca3af' }}>No authors yet — create them in the Authors tab.</span>}
        </div>
      </div>
    </Card>
  );
}

// ── Copies ──────────────────────────────────────────────────────────────────

function CopiesTab({
  canCreate,
  canUpdate,
  canBarcode,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canBarcode: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [lookups, setLookups] = useState<LookupsPayload | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [barcode, setBarcode] = useState<CopyBarcodePayload | null>(null);
  const [txn, setTxn] = useState<TransactionRow[] | null>(null);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    params.set('skip', String(skip));
    params.set('take', '25');
    try {
      const res = await apiFetch<Paged<CopyRow>>(`/library/copies?${params.toString()}`);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load copies.');
    }
  }, [search, status, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch<LookupsPayload>('/library/lookups').then(setLookups).catch(() => undefined);
  }, []);

  const openBarcode = async (id: string) => {
    try {
      setBarcode(await apiFetch<CopyBarcodePayload>(`/library/copies/${id}/barcode`));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load barcode.');
    }
  };

  const openTxn = async (id: string) => {
    try {
      const res = await apiFetch<Paged<TransactionRow>>(`/library/copies/${id}/transactions?take=50`);
      setTxn(res.items);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load transactions.');
    }
  };

  const setCopyStatusAction = async (id: string, next: string) => {
    if (!window.confirm(`Set this copy's status to ${next}?`)) return;
    await run(() => apiFetch(`/library/copies/${id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) }), `Copy marked ${next}.`, onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Copies ({total})</h2>
        {canCreate && <Button onClick={() => setShowAdd(true)}>Add copies</Button>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setSkip(0); }} placeholder="Search barcode / accession" style={{ flex: 1, minWidth: 220 }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} style={{ ...selectStyle, width: 180 }}>
          <option value="">All statuses</option>
          {(lookups?.copyStatuses ?? []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No copies match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Barcode</th>
              <th style={{ padding: 8 }}>Accession</th>
              <th style={{ padding: 8 }}>Book</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Condition</th>
              <th style={{ padding: 8 }}>Current loan</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{c.barcode}</td>
                <td style={{ padding: 8 }}>{c.accessionNumber}</td>
                <td style={{ padding: 8 }}>{c.book.title}</td>
                <td style={{ padding: 8 }}>
                  <StatusBadge status={c.status} />
                </td>
                <td style={{ padding: 8 }}>{c.condition}</td>
                <td style={{ padding: 8 }}>
                  {c.loans && c.loans.length > 0 && (
                    <span>
                      {c.loans[0]?.member?.fullName ?? '—'} · due {c.loans[0]?.dueDate ? fmtDate(c.loans[0]?.dueDate) : '—'}
                    </span>
                  )}
                  {(!c.loans || c.loans.length === 0) && '—'}
                </td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canBarcode && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void openBarcode(c.id)}>Barcode</Button>}
                  <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void openTxn(c.id)}>History</Button>
                  {canUpdate && (
                    <>
                      {(c.status === 'AVAILABLE' || c.status === 'RESERVED') && (
                        <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void setCopyStatusAction(c.id, 'WITHDRAWN')}>Withdraw</Button>
                      )}
                      {(c.status === 'WITHDRAWN' || c.status === 'DAMAGED') && (
                        <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void setCopyStatusAction(c.id, 'AVAILABLE')}>Restore</Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 25))}>Prev</Button>
        <Button variant="secondary" disabled={skip + 25 >= total} onClick={() => setSkip((s) => s + 25)}>Next</Button>
      </div>

      {showAdd && (
        <AddCopiesForm
          lookups={lookups}
          onClose={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); void load(); }}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {barcode && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>Labels — {barcode.bookTitle} ({barcode.barcode})</h2>
            <Button variant="secondary" onClick={() => setBarcode(null)}>Close</Button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 6 }}>Barcode (Code 128)</div>
              <img src={barcode.code128} alt="barcode" style={{ background: '#fff', padding: 8 }} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 6 }}>QR</div>
              <img src={barcode.qr} alt="QR" style={{ background: '#fff', padding: 8 }} />
            </div>
          </div>
        </Card>
      )}

      {txn && (
        <TransactionsCard rows={txn} onClose={() => setTxn(null)} />
      )}
    </Card>
  );
}

function AddCopiesForm({
  lookups,
  onClose,
  onDone,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload | null;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [bookId, setBookId] = useState('');
  const [count, setCount] = useState('1');
  const [barcode, setBarcode] = useState('');
  const [accessionNumber, setAccessionNumber] = useState('');

  useEffect(() => {
    apiFetch<Paged<BookRow>>('/library/books?take=100')
      .then((res) => setBooks(res.items.filter((b) => b.isActive)))
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!bookId) {
      onError('Select a book.');
      return;
    }
    const body: Record<string, unknown> = {
      ...(count !== '1' ? { count: Number(count) } : {}),
      ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
      ...(accessionNumber.trim() ? { accessionNumber: accessionNumber.trim() } : {}),
    };
    try {
      await apiFetch(`/library/books/${bookId}/copies`, { method: 'POST', body: JSON.stringify(body) });
      onNotice('Copies added.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add copies.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Add copies</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Add</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={bookId} onChange={(e) => setBookId(e.target.value)} style={{ ...selectStyle, flex: 2, minWidth: 260 }}>
          <option value="">Select book…</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
        <Input value={count} onChange={(e) => setCount(e.target.value)} placeholder="Count" type="number" style={{ width: 80 }} />
        <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Barcode (optional)" style={{ flex: 1, minWidth: 160 }} />
        <Input value={accessionNumber} onChange={(e) => setAccessionNumber(e.target.value)} placeholder="Accession (optional)" style={{ flex: 1, minWidth: 160 }} />
      </div>
      <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 6 }}>
        Leave count above 1 and blank barcode to auto-assign serial-number barcodes. {!lookups && 'Loading lookups…'}
      </div>
    </Card>
  );
}

function TransactionsCard({ rows, onClose }: { rows: TransactionRow[]; onClose: () => void }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Copy history</h2>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No transactions yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>When</th>
              <th style={{ padding: 8 }}>Member</th>
              <th style={{ padding: 8 }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{t.type}</td>
                <td style={{ padding: 8 }}>{fmtDate(t.occurredAt)}</td>
                <td style={{ padding: 8 }}>{t.member?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{t.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersTab({
  canCreate,
  canUpdate,
  canDelete,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [memberType, setMemberType] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [lookups, setLookups] = useState<LookupsPayload | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (memberType) params.set('memberType', memberType);
    if (status) params.set('status', status);
    params.set('skip', String(skip));
    params.set('take', '25');
    try {
      const res = await apiFetch<Paged<MemberRow>>(`/library/members?${params.toString()}`);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load members.');
    }
  }, [search, memberType, status, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    apiFetch<LookupsPayload>('/library/lookups').then(setLookups).catch(() => undefined);
  }, []);

  const setStatusAction = async (id: string, next: string) => {
    await run(() => apiFetch(`/library/members/${id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) }), `Member marked ${next}.`, onNotice, onError);
    void load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this member?')) return;
    await run(() => apiFetch(`/library/members/${id}`, { method: 'DELETE' }), 'Member deleted.', onNotice, onError);
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Members ({total})</h2>
        {canCreate && <Button onClick={() => { setEditing(null); setShowForm(true); }}>New member</Button>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setSkip(0); }} placeholder="Search name / number / email" style={{ flex: 1, minWidth: 220 }} />
        <select value={memberType} onChange={(e) => { setMemberType(e.target.value); setSkip(0); }} style={{ ...selectStyle, width: 150 }}>
          <option value="">All types</option>
          {(lookups?.memberTypes ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setSkip(0); }} style={{ ...selectStyle, width: 160 }}>
          <option value="">All statuses</option>
          {(lookups?.memberStatuses ?? []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No members match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Member #</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Active loans</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{m.memberNumber}</td>
                <td style={{ padding: 8 }}>
                  {m.fullName}
                  {m.student && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{m.student.admissionNumber ?? 'student'}</div>}
                </td>
                <td style={{ padding: 8 }}>{m.memberType}</td>
                <td style={{ padding: 8 }}><StatusBadge status={m.status} /></td>
                <td style={{ padding: 8 }}>{m.activeLoanCount ?? 0}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canUpdate && <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => { setEditing(m); setShowForm(true); }}>Edit</Button>}
                  {canUpdate && m.status === 'ACTIVE' && (
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void setStatusAction(m.id, 'SUSPENDED')}>Suspend</Button>
                  )}
                  {canUpdate && m.status !== 'ACTIVE' && (
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void setStatusAction(m.id, 'ACTIVE')}>Reactivate</Button>
                  )}
                  {canDelete && <Button variant="secondary" onClick={() => void remove(m.id)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 25))}>Prev</Button>
        <Button variant="secondary" disabled={skip + 25 >= total} onClick={() => setSkip((s) => s + 25)}>Next</Button>
      </div>

      {showForm && (
        <MemberForm
          row={editing}
          canSave={canCreate || canUpdate}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onDone={() => { setShowForm(false); setEditing(null); void load(); }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </Card>
  );
}

function MemberForm({
  row,
  canSave,
  onClose,
  onDone,
  onError,
  onNotice,
}: {
  row: MemberRow | null;
  canSave: boolean;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [f, setF] = useState(() => ({
    memberNumber: row?.memberNumber ?? '',
    fullName: row?.fullName ?? '',
    email: row?.email ?? '',
    phone: row?.phone ?? '',
    memberType: row?.memberType ?? 'STUDENT',
    maxLoans: row?.maxLoans != null ? String(row.maxLoans) : '',
  }));

  const save = async () => {
    if (!f.fullName.trim()) {
      onError('Full name is required.');
      return;
    }
    const body = {
      ...(f.memberNumber.trim() ? { memberNumber: f.memberNumber.trim() } : {}),
      fullName: f.fullName.trim(),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
      memberType: f.memberType,
      ...(f.maxLoans.trim() ? { maxLoans: Number(f.maxLoans) } : {}),
    };
    try {
      if (row) {
        await apiFetch(`/library/members/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        onNotice('Member updated.');
      } else {
        await apiFetch('/library/members', { method: 'POST', body: JSON.stringify(body) });
        onNotice('Member created.');
      }
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save member.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{row ? `Edit member — ${row.fullName}` : 'New member'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canSave && <Button onClick={() => void save()}>Save</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input value={f.memberNumber} onChange={(e) => setF({ ...f, memberNumber: e.target.value })} placeholder="Member number (optional)" style={{ flex: 1, minWidth: 200 }} />
        <Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} placeholder="Full name" style={{ flex: 2, minWidth: 220 }} />
        <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" style={{ flex: 1, minWidth: 200 }} />
        <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone" style={{ flex: 1, minWidth: 160 }} />
        <select value={f.memberType} onChange={(e) => setF({ ...f, memberType: e.target.value })} style={{ ...selectStyle, width: 150 }}>
          {['STUDENT', 'FACULTY', 'STAFF', 'OTHER'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <Input value={f.maxLoans} onChange={(e) => setF({ ...f, maxLoans: e.target.value })} placeholder="Max loans" type="number" style={{ width: 110 }} />
      </div>
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 6 }}>
        Tip: to link an existing student/user, use the API (create with <code>studentId</code>/<code>userId</code>). Blank member number auto-generates.
      </p>
    </Card>
  );
}

// ── Circulation ─────────────────────────────────────────────────────────────

function CirculationTab({
  canCreate,
  canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<LoanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [showIssue, setShowIssue] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (overdueOnly) params.set('overdueOnly', 'true');
    if (search) params.set('search', search);
    params.set('skip', '0');
    params.set('take', '50');
    try {
      const res = await apiFetch<Paged<LoanRow>>(`/library/loans?${params.toString()}`);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load loans.');
    }
  }, [status, overdueOnly, search, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const renew = async (id: string) => {
    const days = window.prompt('Renew by how many days? (blank uses the default)', '');
    if (days === null) return;
    await run(
      () => apiFetch(`/library/loans/${id}/renew`, { method: 'PATCH', body: JSON.stringify({ ...(days && Number(days) ? { days: Number(days) } : {}) }) }),
      'Loan renewed.',
      onNotice,
      onError,
    );
    void load();
  };

  const doReturn = async (id: string) => {
    const condition = window.prompt('Return condition (NEW/GOOD/FAIR/POOR/DAMAGED) — blank = GOOD', 'GOOD');
    if (condition === null) return;
    await run(
      () => apiFetch(`/library/loans/${id}/return`, { method: 'POST', body: JSON.stringify({ ...(condition.trim() ? { condition: condition.trim() } : {}) }) }),
      'Loan returned.',
      onNotice,
      onError,
    );
    void load();
  };

  const markLost = async (id: string) => {
    if (!window.confirm('Mark this loan as lost? A replacement-cost fine will be created for the member.')) return;
    await run(() => apiFetch(`/library/loans/${id}/mark-lost`, { method: 'POST', body: JSON.stringify({}) }), 'Loan marked lost.', onNotice, onError);
    void load();
  };

  const sweep = async () => {
    if (!window.confirm('Sweep overdue loans now? Overdue fines will sync for all overdue members.')) return;
    await run(() => apiFetch('/library/loans/sweep-overdue', { method: 'POST', body: JSON.stringify({}) }), 'Overdue sweep complete.', onNotice, onError);
    void load();
  };

  const isActive = (s: string) => s === 'ISSUED' || s === 'OVERDUE';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Loans ({total})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreate && <Button onClick={() => setShowIssue(true)}>Issue loan</Button>}
          {canManage && <Button variant="secondary" onClick={() => void sweep()}>Sweep overdue</Button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setOverdueOnly(false); }} style={{ ...selectStyle, width: 160 }}>
          <option value="">All statuses</option>
          {['ISSUED', 'OVERDUE', 'RETURNED', 'LOST'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setStatus(''); }} />
          Overdue only
        </label>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / member" style={{ flex: 1, minWidth: 220 }} />
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No loans match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Item</th>
              <th style={{ padding: 8 }}>Member</th>
              <th style={{ padding: 8 }}>Borrowed</th>
              <th style={{ padding: 8 }}>Due</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Fine</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>
                  {l.copy?.book.title ?? l.itemTitle}
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{l.copy?.barcode ?? l.itemCode}</div>
                </td>
                <td style={{ padding: 8 }}>{l.member?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{fmtDate(l.borrowedAt)}</td>
                <td style={{ padding: 8 }}>{l.dueDate ? fmtDate(l.dueDate) : '—'}</td>
                <td style={{ padding: 8 }}>
                  <StatusBadge status={l.status} />
                  {l.renewalCount > 0 && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>renewed ×{l.renewalCount}</div>}
                </td>
                <td style={{ padding: 8 }}>{l.fineCents > 0 ? fmtCents(l.fineCents) : '—'}</td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {isActive(l.status) && canUpdate && (
                    <>
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void doReturn(l.id)}>Return</Button>
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void renew(l.id)}>Renew</Button>
                    </>
                  )}
                  {isActive(l.status) && canManage && (
                    <Button variant="secondary" onClick={() => void markLost(l.id)}>Mark lost</Button>
                  )}
                  {!isActive(l.status) && <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showIssue && (
        <IssueLoanForm
          onClose={() => setShowIssue(false)}
          onDone={() => { setShowIssue(false); void load(); }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </Card>
  );
}

function IssueLoanForm({ onClose, onDone, onError, onNotice }: { onClose: () => void; onDone: () => void; onError: (msg: string | null) => void; onNotice: (msg: string | null) => void }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [memberId, setMemberId] = useState('');
  const [copyId, setCopyId] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    apiFetch<Paged<MemberRow>>('/library/members?status=ACTIVE&take=100')
      .then((res) => setMembers(res.items))
      .catch(() => undefined);
    apiFetch<Paged<CopyRow>>('/library/copies?status=AVAILABLE&take=100')
      .then((res) => setCopies(res.items))
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!memberId || !copyId) {
      onError('Select a member and an available copy.');
      return;
    }
    try {
      await apiFetch('/library/loans', {
        method: 'POST',
        body: JSON.stringify({ memberId, copyId, ...(dueDate ? { dueDate } : {}) }),
      });
      onNotice('Loan issued.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to issue loan.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Issue loan</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Issue</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 240 }}>
          <option value="">Select member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.fullName} ({m.memberNumber})</option>
          ))}
        </select>
        <select value={copyId} onChange={(e) => setCopyId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 260 }}>
          <option value="">Select available copy…</option>
          {copies.map((c) => (
            <option key={c.id} value={c.id}>{c.barcode} — {c.book.title}</option>
          ))}
        </select>
        <Input value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder="Due date (optional)" type="date" style={{ width: 180 }} />
      </div>
    </Card>
  );
}

// ── Reservations ────────────────────────────────────────────────────────────

function ReservationsTab({
  canCreate,
  canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [readyEntry, setReadyEntry] = useState<{ id: string; bookId: string; title: string } | null>(null);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('take', '50');
    try {
      const res = await apiFetch<Paged<ReservationRow>>(`/library/reservations?${params.toString()}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load reservations.');
    }
  }, [status, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this reservation?')) return;
    await run(() => apiFetch(`/library/reservations/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }), 'Reservation cancelled.', onNotice, onError);
    void load();
  };

  const expireSweep = async () => {
    await run(() => apiFetch('/library/reservations/expire-sweep', { method: 'POST', body: JSON.stringify({}) }), 'Expired holds released.', onNotice, onError);
    void load();
  };

  const activeStatus = (s: string) => s === 'WAITING' || s === 'READY';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Reservations</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreate && <Button onClick={() => setShowForm(true)}>New reservation</Button>}
          {canManage && <Button variant="secondary" onClick={() => void expireSweep()}>Release expired</Button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, width: 160 }}>
          <option value="">All statuses</option>
          {['WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No reservations match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Book</th>
              <th style={{ padding: 8 }}>Member</th>
              <th style={{ padding: 8 }}>Reserved</th>
              <th style={{ padding: 8 }}>Hold until</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>
                  {r.book.title}
                  {r.copy && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{r.copy.barcode}</div>}
                </td>
                <td style={{ padding: 8 }}>{r.member.fullName}</td>
                <td style={{ padding: 8 }}>{fmtDate(r.reservedAt)}</td>
                <td style={{ padding: 8 }}>{r.holdUntil ? fmtDate(r.holdUntil) : '—'}</td>
                <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.status === 'WAITING' && canUpdate && (
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setReadyEntry({ id: r.id, bookId: r.bookId, title: r.book.title })}>
                      Assign copy
                    </Button>
                  )}
                  {activeStatus(r.status) && canUpdate && (
                    <Button variant="secondary" onClick={() => void cancel(r.id)}>Cancel</Button>
                  )}
                  {!activeStatus(r.status) && <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <ReservationForm
          onClose={() => setShowForm(false)}
          onDone={() => { setShowForm(false); void load(); }}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {readyEntry && (
        <AssignCopyForm entry={readyEntry} onClose={() => setReadyEntry(null)} onDone={() => { setReadyEntry(null); void load(); }} onError={onError} onNotice={onNotice} />
      )}
    </Card>
  );
}

function ReservationForm({ onClose, onDone, onError, onNotice }: { onClose: () => void; onDone: () => void; onError: (msg: string | null) => void; onNotice: (msg: string | null) => void }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [memberId, setMemberId] = useState('');
  const [bookId, setBookId] = useState('');

  useEffect(() => {
    apiFetch<Paged<MemberRow>>('/library/members?status=ACTIVE&take=100')
      .then((res) => setMembers(res.items))
      .catch(() => undefined);
    apiFetch<Paged<BookRow>>('/library/books?isActive=true&take=100')
      .then((res) => setBooks(res.items))
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!memberId || !bookId) {
      onError('Select a member and a book.');
      return;
    }
    try {
      await apiFetch('/library/reservations', { method: 'POST', body: JSON.stringify({ memberId, bookId }) });
      onNotice('Reservation created.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create reservation.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>New reservation</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Reserve</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 240 }}>
          <option value="">Select member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.fullName} ({m.memberNumber})</option>
          ))}
        </select>
        <select value={bookId} onChange={(e) => setBookId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 260 }}>
          <option value="">Select book…</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
      </div>
    </Card>
  );
}

function AssignCopyForm({ entry, onClose, onDone, onError, onNotice }: { entry: { id: string; bookId: string; title: string }; onClose: () => void; onDone: () => void; onError: (msg: string | null) => void; onNotice: (msg: string | null) => void }) {
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [copyId, setCopyId] = useState('');

  useEffect(() => {
    apiFetch<Paged<CopyRow>>(`/library/copies?bookId=${entry.bookId}&status=AVAILABLE&take=50`)
      .then((res) => setCopies(res.items))
      .catch(() => undefined);
  }, [entry.bookId]);

  const submit = async () => {
    if (!copyId) {
      onError('Select an available copy.');
      return;
    }
    try {
      await apiFetch(`/library/reservations/${entry.id}/ready`, { method: 'POST', body: JSON.stringify({ copyId }) });
      onNotice('Reservation set READY; copy reserved.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to assign copy.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Assign copy — {entry.title}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Assign</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
      <select value={copyId} onChange={(e) => setCopyId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
        <option value="">Select available copy…</option>
        {copies.map((c) => (
          <option key={c.id} value={c.id}>{c.barcode} — {c.accessionNumber}</option>
        ))}
      </select>
    </Card>
  );
}

// ── Fines ───────────────────────────────────────────────────────────────────

function FinesTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (msg: string | null) => void; onNotice: (msg: string | null) => void }) {
  const [rows, setRows] = useState<FineRow[]>([]);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    params.set('take', '50');
    try {
      const res = await apiFetch<Paged<FineRow>>(`/library/fines?${params.toString()}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load fines.');
    }
  }, [status, type, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async (id: string) => {
    await run(() => apiFetch(`/library/fines/${id}/pay`, { method: 'POST', body: JSON.stringify({}) }), 'Fine settled.', onNotice, onError);
    void load();
  };

  const waive = async (id: string) => {
    const reason = window.prompt('Reason for waiver:', '');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('A reason is required to waive a fine.');
      return;
    }
    await run(
      () => apiFetch(`/library/fines/${id}/waive`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
      'Fine waived.',
      onNotice,
      onError,
    );
    void load();
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Fines</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...selectStyle, width: 140 }}>
            <option value="">All types</option>
            {['OVERDUE', 'LOST', 'DAMAGE', 'OTHER'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, width: 150 }}>
            <option value="">All statuses</option>
            {['PENDING', 'PAID', 'WAIVED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No fines match the filters.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Member</th>
              <th style={{ padding: 8 }}>Item</th>
              <th style={{ padding: 8 }}>Amount</th>
              <th style={{ padding: 8 }}>Paid</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{f.type}</td>
                <td style={{ padding: 8 }}>{f.member.fullName}</td>
                <td style={{ padding: 8 }}>{f.loan?.copy?.book.title ?? f.loan?.itemTitle ?? '—'}</td>
                <td style={{ padding: 8 }}>{fmtCents(f.amountCents)}</td>
                <td style={{ padding: 8 }}>{fmtCents(f.paidCents)}</td>
                <td style={{ padding: 8 }}><StatusBadge status={f.status} /></td>
                <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {f.status === 'PENDING' && canManage && (
                    <>
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void pay(f.id)}>Pay</Button>
                      <Button variant="secondary" onClick={() => void waive(f.id)}>Waive</Button>
                    </>
                  )}
                  {f.status !== 'PENDING' && <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Config ──────────────────────────────────────────────────────────────────

function ConfigTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (msg: string | null) => void; onNotice: (msg: string | null) => void }) {
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  const [f, setF] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    onError(null);
    try {
      const c = await apiFetch<LibraryConfig>('/library/config');
      setConfig(c);
      setF({
        defaultLoanDays: String(c.defaultLoanDays),
        maxLoansPerMember: String(c.maxLoansPerMember),
        renewalLimit: String(c.renewalLimit),
        overdueFinePerDayCents: String(c.overdueFinePerDayCents),
        reservationHoldDays: String(c.reservationHoldDays),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load configuration.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      await apiFetch('/library/config', {
        method: 'PUT',
        body: JSON.stringify({
          defaultLoanDays: Number(f.defaultLoanDays) || undefined,
          maxLoansPerMember: Number(f.maxLoansPerMember) || undefined,
          renewalLimit: Number(f.renewalLimit) || undefined,
          overdueFinePerDayCents: Number(f.overdueFinePerDayCents) || undefined,
          reservationHoldDays: Number(f.reservationHoldDays) || undefined,
        }),
      });
      onNotice('Configuration saved.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save configuration.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Circulation rules</h2>
        {canManage && <Button onClick={() => void save()}>Save</Button>}
      </div>
      {!config && <p style={{ color: '#9ca3af' }}>Loading configuration…</p>}
      {config && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Default loan days
            <Input value={f.defaultLoanDays ?? ''} type="number" onChange={(e) => setF({ ...f, defaultLoanDays: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Max loans per member
            <Input value={f.maxLoansPerMember ?? ''} type="number" onChange={(e) => setF({ ...f, maxLoansPerMember: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Renewal limit (times)
            <Input value={f.renewalLimit ?? ''} type="number" onChange={(e) => setF({ ...f, renewalLimit: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Overdue fine per day (paise)
            <Input value={f.overdueFinePerDayCents ?? ''} type="number" onChange={(e) => setF({ ...f, overdueFinePerDayCents: e.target.value })} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Reservation hold days
            <Input value={f.reservationHoldDays ?? ''} type="number" onChange={(e) => setF({ ...f, reservationHoldDays: e.target.value })} />
          </label>
        </div>
      )}
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    AVAILABLE: '#15803d',
    ISSUED: '#3b82f6',
    RESERVED: '#8b5cf6',
    OVERDUE: '#b91c1c',
    RETURNED: '#15803d',
    LOST: '#6b7280',
    DAMAGED: '#f59e0b',
    WITHDRAWN: '#6b7280',
    WAITING: '#f59e0b',
    READY: '#8b5cf6',
    FULFILLED: '#15803d',
    CANCELLED: '#6b7280',
    EXPIRED: '#6b7280',
    PENDING: '#f59e0b',
    PAID: '#15803d',
    WAIVED: '#6b7280',
    ACTIVE: '#15803d',
    INACTIVE: '#9ca3af',
    SUSPENDED: '#b91c1c',
    CLOSED: '#6b7280',
  };
  return <span style={{ color: color[status] ?? '#111827', fontWeight: 600 }}>{status}</span>;
}