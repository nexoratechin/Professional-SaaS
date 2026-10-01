/**
 * The SaaS / control-plane analytics dashboard (`/platform/analytics`).
 *
 * Reads `/platform/analytics/overview` (MRR/ARR, tenants, subscriptions, churn, revenue, usage,
 * metered students, active users) and `/platform/analytics/usage` (the metered-usage drill-down)
 * through `lib/platform-http.ts` — deliberately, so this page structurally cannot acquire a tenant
 * context. It lives in the platform realm's route tree under `PlatformProtectedRoute`, so the
 * `PlatformAuthGuard`-issued token is the only credential in play, and the API's
 * `TenantResolutionMiddleware` never even resolves a tenant for `platform/**`.
 *
 * Note what is NOT gated here: unlike the tenant `/analytics` page, these routes do not require the
 * `analytics.advanced` entitlement. That entitlement is a *tenant's* plan add-on; the platform
 * selling it must always be able to see whether anyone bought it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SaasAnalyticsOverviewDto, SaasUsageAnalyticsDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';
import {
  FreshnessNote,
  MetricTile,
  SeriesGrid,
  StatusBreakdown,
  TileGrid,
  WindowControls,
  buildAnalyticsQuery,
  formatCents,
  formatCount,
  formatPercent,
  tdStyle,
  thStyle,
  tableStyle,
  type AnalyticsWindowSelection,
} from '../analytics-ui';

const DEFAULT_SELECTION: AnalyticsWindowSelection = {
  granularity: 'DAILY',
  periods: 30,
  live: false,
  includeCurrent: false,
};

type Tab = 'overview' | 'usage';

export function PlatformAnalyticsPage() {
  const [selection, setSelection] = useState<AnalyticsWindowSelection>(DEFAULT_SELECTION);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<SaasAnalyticsOverviewDto | null>(null);
  const [usage, setUsage] = useState<SaasUsageAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = buildAnalyticsQuery(selection);
    try {
      if (tab === 'overview') {
        setOverview(await platformApiFetch<SaasAnalyticsOverviewDto>(`/platform/analytics/overview?${query}`));
      } else {
        // `live` is meaningless here: the usage drill-down is always a live GROUP BY, because
        // `UsageEvent` has no per-tenant dimension in the rollup to serve from a snapshot.
        setUsage(await platformApiFetch<SaasUsageAnalyticsDto>(`/platform/analytics/usage?${query}`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform analytics.');
    } finally {
      setLoading(false);
    }
  }, [selection, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: '1.25rem' }}>SaaS Analytics</h1>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
            Recurring revenue, tenant growth and metered usage across every college on the platform.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant={tab === 'overview' ? 'primary' : 'secondary'}
            onClick={() => setTab('overview')}
          >
            Revenue
          </Button>
          <Button variant={tab === 'usage' ? 'primary' : 'secondary'} onClick={() => setTab('usage')}>
            Usage
          </Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </Button>
        </div>
      </div>

      <Card>
        <WindowControls selection={selection} onChange={setSelection} busy={loading} />
        {tab === 'overview' && overview && (
          <div style={{ marginTop: 12 }}>
            <FreshnessNote window={overview.window} meta={overview.meta} />
          </div>
        )}
        {tab === 'usage' && usage && (
          <div style={{ marginTop: 12 }}>
            <FreshnessNote window={usage.window} meta={usage.meta} />
          </div>
        )}
        {error && <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: 8 }}>{error}</p>}
      </Card>

      {tab === 'overview' && overview && <OverviewTab data={overview} />}
      {tab === 'usage' && usage && <UsageTab data={usage} />}

      {!overview && !usage && !error && <p style={{ color: '#9ca3af' }}>Loading platform analytics…</p>}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>How to read this page</h2>
        <ul style={{ fontSize: '0.8rem', color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>
            MRR, ARR and the tenant/subscription counts are read from the <em>newest</em> bucket. Summing
            a stock across the window would multiply it.
          </li>
          <li>
            Revenue and the new/expansion/contraction/churn split are summed over the window, and
            outstanding is re-derived as billed − collected so a receivable billed in one bucket and
            collected in the next is not counted twice.
          </li>
          <li>
            Churn is attributed to the bucket the subscription left in, so a cancellation on the 3rd shows
            up in that day's churn rather than the next one.
          </li>
          <li>
            &quot;Sign-ins&quot; is a per-bucket count off <code>User.lastLoginAt</code>, not distinct monthly
            actives — summing daily buckets would report user-<em>days</em>.
          </li>
          <li>
            A gap in a chart means the bucket could not be computed; it is not a zero.
          </li>
        </ul>
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 8 }}>
          <Link to="/platform/dashboard">&larr; Control plane dashboard</Link>
        </p>
      </Card>
    </div>
  );
}

function OverviewTab({ data }: { data: SaasAnalyticsOverviewDto }): React.ReactElement {
  return (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>Recurring revenue</h2>
        <TileGrid>
          <MetricTile label="MRR" value={formatCents(data.mrrCents)} hint="as of the newest bucket" />
          <MetricTile label="ARR" value={formatCents(data.arrCents)} hint="MRR × 12 run rate" />
          <MetricTile
            label="MRR churn"
            value={formatPercent(data.mrrChurnPercent)}
            tone={data.mrrChurnPercent > 5 ? 'bad' : data.mrrChurnPercent > 2 ? 'warn' : 'good'}
          />
          <MetricTile
            label="Customer churn"
            value={formatPercent(data.customerChurnPercent)}
            tone={data.customerChurnPercent > 5 ? 'bad' : data.customerChurnPercent > 2 ? 'warn' : 'good'}
          />
          <MetricTile label="Net new MRR" value={formatCents(data.netNewMrrCents)} hint="window movement" tone={data.netNewMrrCents < 0 ? 'bad' : 'good'} />
        </TileGrid>
        <TileGrid>
          <MetricTile label="New MRR" value={formatCents(data.newMrrCents)} hint="window" />
          <MetricTile label="Expansion" value={formatCents(data.expansionMrrCents)} hint="window" />
          <MetricTile label="Contraction" value={formatCents(data.contractionMrrCents)} hint="window" tone={data.contractionMrrCents > 0 ? 'warn' : 'default'} />
          <MetricTile label="Churned" value={formatCents(data.churnedMrrCents)} hint="window" tone={data.churnedMrrCents > 0 ? 'bad' : 'default'} />
        </TileGrid>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>Tenants &amp; subscriptions</h2>
        <TileGrid>
          <MetricTile label="Tenants" value={formatCount(data.totalTenants)} hint="as of the newest bucket" />
          <MetricTile label="Active tenants" value={formatCount(data.activeTenants)} hint="as of the newest bucket" />
          <MetricTile label="New paying logos" value={formatCount(data.newTenantCount)} hint="MRR movement found in the window" />
          <MetricTile label="Churned tenants" value={formatCount(data.churnedTenantCount)} hint="window" tone={data.churnedTenantCount > 0 ? 'bad' : 'good'} />
          <MetricTile
            label="Tenants onboarded"
            value={formatCount(data.createdTenants)}
            hint="created in the window — can precede the first subscription by months"
          />
          <MetricTile label="Recurring subs" value={formatCount(data.recurringSubscriptionCount)} hint="as of the newest bucket" />
        </TileGrid>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>Usage &amp; revenue</h2>
        <TileGrid>
          <MetricTile label="Users" value={formatCount(data.totalUserCount)} hint="as of the newest bucket" />
          <MetricTile label="Sign-ins" value={formatCount(data.activeUserCount)} hint="newest bucket only, not distinct actives" />
          <MetricTile label="Metered students" value={formatCount(data.meteredStudentCount)} hint="what the billing engine invoices against" />
          <MetricTile label="Billed" value={formatCents(data.billedCents)} hint="window" />
          <MetricTile label="Collected" value={formatCents(data.collectedCents)} hint="window" />
          <MetricTile
            label="Outstanding"
            value={formatCents(data.outstandingCents)}
            hint="billed − collected across the window"
            tone={data.outstandingCents > 0 ? 'warn' : 'good'}
          />
        </TileGrid>
      </section>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Trends</h2>
        <SeriesGrid series={data.series} />
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Top tenants by MRR</h2>
        {data.topTenantsByMrr.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No tenants with MRR in this window.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Slug</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {data.topTenantsByMrr.map((tenant) => (
                <tr key={tenant.tenantId}>
                  <td style={tdStyle}>
                    <Link to={`/platform/tenants/${tenant.tenantId}`}>{tenant.tenantName}</Link>
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{tenant.tenantSlug}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCents(tenant.mrrCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Distributions &amp; metered events</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <StatusBreakdown title="Tenants by status" rows={data.tenantCountByStatus} total={data.totalTenants} />
          <StatusBreakdown title="Subscriptions by status" rows={data.subscriptionsByStatus} total={data.recurringSubscriptionCount} />
        </div>
        <h3 style={{ fontSize: '0.9rem', margin: '16px 0 6px' }}>Usage events by type (window)</h3>
        {data.usageByEventType.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No metered usage recorded in this window.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Event type</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {data.usageByEventType.map((row) => (
                <tr key={row.eventType}>
                  <td style={tdStyle}>{row.eventType}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCount(row.quantity)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCount(row.eventCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 8 }}>
          The Usage tab breaks the same events down per tenant.
        </p>
      </Card>
    </>
  );
}

function UsageTab({ data }: { data: SaasUsageAnalyticsDto }): React.ReactElement {
  return (
    <>
      <TileGrid>
        <MetricTile label="Quantity" value={formatCount(data.totals.quantity)} hint="summed over the window" />
        <MetricTile label="Events" value={formatCount(data.totals.eventCount)} hint="rows in usage_events" />
        <MetricTile label="Active tenants" value={formatCount(data.totals.activeTenantCount)} hint="distinct tenants emitting events" />
        <MetricTile label="Event types" value={formatCount(data.totals.eventTypeCount)} hint="distinct event types" />
      </TileGrid>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Top tenants by metered usage</h2>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
          Live aggregation over <code>usage_events</code> (served by its{' '}
          <code>(tenant_id, event_type, occurred_at)</code> index) — the rollup only stores event-type
          totals, with no per-tenant dimension, so materializing this would cost a table to answer a
          question the database answers in one pass. The active-tenant count above is the true distinct
          total, not the length of this truncated list.
        </p>
        {data.byTenant.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No metered usage in this window.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Slug</th>
                <th style={thStyle}>Top event</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {data.byTenant.map((row) => (
                <tr key={row.tenantId}>
                  <td style={tdStyle}>
                    <Link to={`/platform/tenants/${row.tenantId}`}>{row.tenantName}</Link>
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{row.tenantSlug}</td>
                  <td style={tdStyle}>{row.topEventType}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCount(row.quantity)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCount(row.eventCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By event type</h2>
        {data.byEventType.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No metered usage in this window.</p>
        ) : (
          <StatusBreakdown
            title=""
            rows={Object.fromEntries(data.byEventType.map((row) => [row.eventType, row.eventCount]))}
            total={data.totals.eventCount}
          />
        )}
      </Card>
    </>
  );
}
