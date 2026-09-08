import React, { useCallback, useEffect, useState } from 'react';
import type { AuditLogEntryDto } from '@college-erp/types';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetchPaged } from '../../lib/platform-http';

const PAGE_SIZE = 25;
const MODULE_OPTIONS = ['', 'auth', 'rbac', 'users', 'tenants', 'saas', 'security', 'documents', 'notifications', 'workflows', 'billing', 'support', 'platform'];

interface Filters {
  tenantId: string;
  module: string;
  action: string;
  entityType: string;
  actorEmail: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  tenantId: '',
  module: '',
  action: '',
  entityType: '',
  actorEmail: '',
  dateFrom: '',
  dateTo: '',
};

function toQueryString(filters: Filters, skip: number): string {
  const params = new URLSearchParams();
  params.set('skip', String(skip));
  params.set('take', String(PAGE_SIZE));
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  if (filters.module) params.set('module', filters.module);
  if (filters.action) params.set('action', filters.action);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.actorEmail) params.set('actorEmail', filters.actorEmail);
  if (filters.dateFrom) params.set('dateFrom', new Date(filters.dateFrom).toISOString());
  if (filters.dateTo) params.set('dateTo', new Date(filters.dateTo).toISOString());
  return params.toString();
}

/** Requires PLATFORM_ADMIN (see AuditController) — a PLATFORM_SUPPORT user will see the error
 * message from a 403 response rather than a client-side permission pre-check, matching how
 * errors surface throughout the rest of this admin area. */
export function PlatformAuditLogPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [skip, setSkip] = useState(0);
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = toQueryString(filters, skip);
      const { data, total: totalCount } = await platformApiFetchPaged<AuditLogEntryDto[]>(`/platform/audit-logs?${qs}`);
      setEntries(data);
      setTotal(totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [filters, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFilterChange = (key: keyof Filters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setSkip(0);
    void load();
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSkip(0);
  };

  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Platform Audit Log</h1>

      <Card>
        <form
          onSubmit={applyFilters}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}
        >
          <Input
            label="Tenant ID"
            value={filters.tenantId}
            onChange={(event) => handleFilterChange('tenantId', event.target.value)}
            placeholder="leave blank for all tenants"
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="audit-module" style={{ fontSize: '0.85rem', color: '#374151' }}>
              Module
            </label>
            <select
              id="audit-module"
              value={filters.module}
              onChange={(event) => handleFilterChange('module', event.target.value)}
              style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              {MODULE_OPTIONS.map((moduleOption) => (
                <option key={moduleOption} value={moduleOption}>
                  {moduleOption === '' ? 'All modules' : moduleOption}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Action"
            value={filters.action}
            onChange={(event) => handleFilterChange('action', event.target.value)}
            placeholder="e.g. TENANT_STATUS_CHANGED"
          />
          <Input
            label="Entity type"
            value={filters.entityType}
            onChange={(event) => handleFilterChange('entityType', event.target.value)}
          />
          <Input
            label="Actor email"
            value={filters.actorEmail}
            onChange={(event) => handleFilterChange('actorEmail', event.target.value)}
            placeholder="contains…"
          />
          <Input
            label="From"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => handleFilterChange('dateFrom', event.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={filters.dateTo}
            onChange={(event) => handleFilterChange('dateTo', event.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Button type="submit">Search</Button>
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {!loading && !error && entries.length === 0 && <p>No audit entries match these filters.</p>}
        {!loading && !error && entries.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '6px 8px' }}>Time</th>
                  <th style={{ padding: '6px 8px' }}>Tenant</th>
                  <th style={{ padding: '6px 8px' }}>Module</th>
                  <th style={{ padding: '6px 8px' }}>Action</th>
                  <th style={{ padding: '6px 8px' }}>Actor</th>
                  <th style={{ padding: '6px 8px' }}>Entity</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{entry.tenantId ? entry.tenantId.slice(0, 8) : '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{entry.module}</td>
                    <td style={{ padding: '6px 8px' }}>{entry.action}</td>
                    <td style={{ padding: '6px 8px' }}>{entry.actorEmail ?? entry.actorType}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {entry.entityType}
                      {entry.entityId ? ` #${entry.entityId.slice(0, 8)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {total} total entries — page {page} of {pageCount}
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
