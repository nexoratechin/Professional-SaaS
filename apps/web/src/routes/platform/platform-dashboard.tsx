import React, { useEffect, useState } from 'react';
import type { PlatformDashboardSummaryDto, StorageUsageByTenantDto, SystemHealthDto } from '@college-erp/types';
import { Card } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

const STATUS_COLORS: Record<string, string> = {
  ok: '#15803d',
  degraded: '#b91c1c',
};

export function PlatformDashboardPage() {
  const [summary, setSummary] = useState<PlatformDashboardSummaryDto | null>(null);
  const [health, setHealth] = useState<SystemHealthDto | null>(null);
  const [storageByTenant, setStorageByTenant] = useState<StorageUsageByTenantDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      platformApiFetch<PlatformDashboardSummaryDto>('/platform/dashboard/summary'),
      platformApiFetch<SystemHealthDto>('/platform/system/health'),
      platformApiFetch<StorageUsageByTenantDto[]>('/platform/system/storage-usage'),
    ])
      .then(([summaryRes, healthRes, storageRes]) => {
        setSummary(summaryRes);
        setHealth(healthRes);
        setStorageByTenant(storageRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'));
  }, []);

  if (error) {
    return <p style={{ color: '#b91c1c' }}>{error}</p>;
  }
  if (!summary || !health) {
    return <p>Loading dashboard…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Control Plane Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Card>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Total tenants</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{summary.totalTenants}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Active users</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{summary.totalActiveUsers}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Students (proxy: STUDENT-role holders)</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{summary.studentRoleHolders}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Total storage used</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{formatBytes(summary.totalStorageUsedBytes)}</div>
        </Card>
        <Card>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Open support tickets</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{summary.openSupportTickets}</div>
        </Card>
      </div>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>System health</h2>
        <p style={{ color: STATUS_COLORS[health.status] ?? '#111827', fontWeight: 600 }}>{health.status.toUpperCase()}</p>
        <ul>
          <li>
            Database: {health.database.ok ? `ok (${health.database.latencyMs}ms)` : `error — ${health.database.error}`}
          </li>
          <li>Redis: {health.redis.ok ? `ok (${health.redis.latencyMs}ms)` : `error — ${health.redis.error}`}</li>
        </ul>
        <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Checked at {new Date(health.timestamp).toLocaleString()}</p>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Tenants by status</h2>
        <ul>
          {Object.entries(summary.tenantsByStatus).map(([status, count]) => (
            <li key={status}>
              {status}: {count}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Subscriptions by status</h2>
        <ul>
          {Object.entries(summary.subscriptionsByStatus).map(([status, count]) => (
            <li key={status}>
              {status}: {count}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Top tenants by storage usage</h2>
        {storageByTenant.length === 0 ? (
          <p>No documents uploaded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '6px 8px' }}>Tenant</th>
                <th style={{ padding: '6px 8px' }}>Documents</th>
                <th style={{ padding: '6px 8px' }}>Storage used</th>
              </tr>
            </thead>
            <tbody>
              {storageByTenant.map((row) => (
                <tr key={row.tenantId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px' }}>{row.tenant?.name ?? row.tenantId}</td>
                  <td style={{ padding: '6px 8px' }}>{row.documentCount}</td>
                  <td style={{ padding: '6px 8px' }}>{formatBytes(row.storageUsedBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
