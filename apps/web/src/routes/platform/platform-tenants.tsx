import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PlatformTenantDto } from '@college-erp/types';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetchPaged } from '../../lib/platform-http';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'];

const STATUS_COLORS: Record<string, string> = {
  TRIAL: '#0369a1',
  ACTIVE: '#15803d',
  SUSPENDED: '#b45309',
  CANCELED: '#6b7280',
};

export function PlatformTenantsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [tenants, setTenants] = useState<PlatformTenantDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String(skip));
      params.set('take', String(PAGE_SIZE));
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const { data, total: totalCount } = await platformApiFetchPaged<PlatformTenantDto[]>(`/tenants?${params}`);
      setTenants(data);
      setTotal(totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants.');
    } finally {
      setLoading(false);
    }
  }, [q, status, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSkip(0);
    void load();
  };

  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Tenants</h1>
        <Link to="/platform/tenants/new">
          <Button>+ New tenant</Button>
        </Link>
      </div>

      <Card>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Input label="Search (slug or name)" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. stmarys" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? 'All' : option}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>

      <Card>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {!loading && !error && tenants.length === 0 && <p>No tenants match these filters.</p>}
        {!loading && !error && tenants.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Slug</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <Link to={`/platform/tenants/${tenant.id}`}>{tenant.name}</Link>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{tenant.slug}</td>
                  <td style={{ padding: '6px 8px', color: STATUS_COLORS[tenant.status] ?? '#111827' }}>{tenant.status}</td>
                  <td style={{ padding: '6px 8px' }}>{new Date(tenant.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {total} total — page {page} of {pageCount}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
              Previous
            </Button>
            <Button variant="secondary" disabled={skip + PAGE_SIZE >= total} onClick={() => setSkip(skip + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
