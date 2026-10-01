/**
 * The per-college advanced analytics dashboard (`/analytics`).
 *
 * Replaces the entitlement demo page that used to live here, in place, and deliberately keeps its
 * `analytics.advanced` gating: the `EntitlementRoute` wrapper in App.tsx and the
 * `useEntitlement('analytics.advanced')` guard below are the navigation half, while the
 * `EntitlementFlagsGuard` on the API is the authoritative one — a direct call to `/analytics/*`
 * from a tenant whose plan lacks the BI module is refused server-side regardless of what the
 * browser renders. The `analytics.view` permission is separately enforced by `PermissionsGuard`,
 * so view rights and the ability to *request* a refresh (`analytics.refresh`) are not the same
 * permission; the refresh button is hidden from a viewer rather than left to fail with a 403.
 *
 * All of the numbers come from `GET /analytics/overview`, which serves them from the materialized
 * `AnalyticsSnapshot` rollup and only recomputes the buckets the worker has not reached. Nothing
 * on this page queries the transactional ledgers itself.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CollegeAnalyticsOverviewDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { useAuth, useEntitlement } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import {
  FunnelBars,
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
  type AnalyticsWindowSelection,
} from './analytics-ui';

const ANALYTICS_VIEW_PERMISSION = 'analytics.view';
const ANALYTICS_REFRESH_PERMISSION = 'analytics.refresh';

const DEFAULT_SELECTION: AnalyticsWindowSelection = {
  granularity: 'DAILY',
  periods: 30,
  live: false,
  includeCurrent: false,
};

export function AdvancedAnalyticsPage() {
  // Belt-and-braces in-page guard even when reached via a direct URL that bypassed the wrapper:
  // the wrapper already redirects, but the hook keeps the component honest.
  const entitled = useEntitlement('analytics.advanced');
  const { permissions } = useAuth();
  const canRefresh = permissions.includes(ANALYTICS_REFRESH_PERMISSION);

  const [selection, setSelection] = useState<AnalyticsWindowSelection>(DEFAULT_SELECTION);
  const [data, setData] = useState<CollegeAnalyticsOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<CollegeAnalyticsOverviewDto>(`/analytics/overview?${buildAnalyticsQuery(selection)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [selection]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Queues the server-side recompute rather than running it inline. The response only confirms the
   * job was accepted, so the page re-reads once immediately and says so — pretending the numbers had
   * already changed would be the kind of quiet lie a dashboard should not tell.
   */
  const requestRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/analytics/refresh', { method: 'POST', body: JSON.stringify(selection) });
      setNotice('Refresh queued. The worker recomputes these buckets; reload to pick up the new rows.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue a refresh.');
    } finally {
      setRefreshing(false);
    }
  }, [selection, load]);

  if (!entitled) {
    return null;
  }

  const scopeNote = data
    ? data.scope.isGlobal
      ? 'Institution-wide — your grants cover every campus, department and program.'
      : `Filtered to ${[data.scope.campusIds.length ? `${data.scope.campusIds.length} campus(es)` : null, data.scope.departmentIds.length ? `${data.scope.departmentIds.length} department(s)` : null, data.scope.programIds.length ? `${data.scope.programIds.length} program(s)` : null]
          .filter(Boolean)
          .join(', ')} by your data grants.`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: '1.25rem' }}>Advanced Analytics</h1>
          <Link to="/dashboard" style={{ fontSize: '0.8rem' }}>&larr; Dashboard</Link>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading || refreshing}>
          {loading ? 'Loading…' : 'Reload'}
        </Button>
      </div>

      <Card>
        <WindowControls
          selection={selection}
          onChange={setSelection}
          busy={loading}
          onRefresh={canRefresh ? () => void requestRefresh() : undefined}
          refreshing={refreshing}
        />
        {data && (
          <div style={{ marginTop: 12 }}>
            <FreshnessNote window={data.window} meta={data.meta} />
            {scopeNote && (
              <div style={{ fontSize: '0.78rem', color: '#6b7280', lineHeight: 1.6, marginTop: 4 }}>{scopeNote}</div>
            )}
          </div>
        )}
        {notice && <p style={{ color: '#15803d', fontSize: '0.8rem', marginTop: 8 }}>{notice}</p>}
        {!canRefresh && (
          <p style={{ color: '#9ca3af', fontSize: '0.78rem', marginTop: 8 }}>
            Your role can view analytics but not request a recompute.
          </p>
        )}
        {error && <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: 8 }}>{error}</p>}
      </Card>

      {data && (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: '1rem' }}>Students &amp; staff</h2>
            <TileGrid>
              <MetricTile label="Students" value={formatCount(data.students.total)} hint="headcount as of the newest bucket" />
              <MetricTile label="New in window" value={formatCount(data.students.newInPeriod)} hint="joined during the window" />
              <MetricTile
                label="Active users"
                value={data.students.activeUserCount === null ? 'n/a' : formatCount(data.students.activeUserCount)}
                hint={
                  data.students.activeUserCount === null
                    ? 'users have no campus/department dimension to scope to your grants'
                    : 'sign-ins in the newest bucket, not distinct users across the window'
                }
              />
              <MetricTile label="Faculty" value={formatCount(data.students.facultyCount)} hint="as of the newest bucket" />
            </TileGrid>
            {data.students.activeUserCount === null && (
              <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                &quot;Active users&quot; is reported as n/a rather than 0: the User table has no org-unit
                dimension, so it cannot be narrowed to your scope, and an institution-wide number would
                leak. The &quot;Sign-ins&quot; chart below carries the per-bucket trend.
              </p>
            )}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: '1rem' }}>Admissions</h2>
            <TileGrid>
              <MetricTile label="Applications" value={formatCount(data.admissions.total)} hint="existing as of the newest bucket" />
              <MetricTile label="Conversion" value={formatPercent(data.admissions.conversionPercent)} hint="enrolled ÷ applications" />
            </TileGrid>
            <Card>
              <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Pipeline funnel</h3>
              <FunnelBars stages={data.admissions.funnel} />
            </Card>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: '1rem' }}>Attendance, fees &amp; results</h2>
            <TileGrid>
              <MetricTile
                label="Attendance"
                value={formatPercent(data.attendance.ratePercent)}
                hint={`${formatCount(data.attendance.present)} present of ${formatCount(data.attendance.marked)} marked, window`}
                tone={data.attendance.ratePercent >= 75 ? 'good' : data.attendance.ratePercent >= 60 ? 'warn' : 'bad'}
              />
              <MetricTile label="Fees billed" value={formatCents(data.fees.billedCents)} hint="summed over the window" />
              <MetricTile label="Fees collected" value={formatCents(data.fees.collectedCents)} hint="summed over the window" />
              <MetricTile
                label="Fees outstanding"
                value={formatCents(data.fees.outstandingCents)}
                hint="billed − collected across the whole window"
                tone={data.fees.outstandingCents > 0 ? 'warn' : 'good'}
              />
              <MetricTile label="Fees overdue" value={formatCents(data.fees.overdueCents)} hint="as of the newest bucket" />
              <MetricTile
                label="Collection rate"
                value={formatPercent(data.fees.collectionRatePercent)}
                tone={data.fees.collectionRatePercent >= 80 ? 'good' : data.fees.collectionRatePercent >= 60 ? 'warn' : 'bad'}
              />
              <MetricTile label="Results published" value={formatCount(data.results.published)} hint="window total" />
              <MetricTile
                label="Pass rate"
                value={formatPercent(data.results.passPercent)}
                hint={`${formatCount(data.results.passCount)} passed, excluding incomplete results`}
              />
              <MetricTile
                label="Average score"
                value={data.results.averagePercentage === null ? '—' : formatPercent(data.results.averagePercentage)}
                hint="newest bucket — a mean of means is not a mean"
              />
            </TileGrid>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: '1rem' }}>Faculty, placements &amp; amenities</h2>
            <TileGrid>
              <MetricTile label="Faculty workload" value={`${formatCount(data.faculty.totalHoursPerWeek)} h/wk`} hint="assigned hours, right now" />
              <MetricTile
                label="Average per faculty"
                value={`${formatCount(data.faculty.averageHours)} h/wk`}
                hint="0 when there is no active faculty"
              />
              <MetricTile
                label="Placement rate"
                value={formatPercent(data.placement.ratePercent)}
                hint={`${formatCount(data.placement.placed)} placed of ${formatCount(data.placement.eligible)} eligible, window`}
              />
              <MetricTile
                label="Average package"
                value={data.placement.averagePackageCents === null ? '—' : formatCents(data.placement.averagePackageCents)}
                hint="newest bucket"
              />
              <MetricTile label="Hostel beds in use" value={formatCount(data.amenities.hostelOccupiedCount)} hint="as of the newest bucket" />
              <MetricTile label="Active library loans" value={formatCount(data.amenities.libraryActiveLoanCount)} hint="as of the newest bucket" />
              <MetricTile label="Active transport passes" value={formatCount(data.amenities.transportActivePassCount)} hint="as of the newest bucket" />
            </TileGrid>
          </section>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Trends</h2>
            <SeriesGrid series={data.series} />
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Distributions</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
              <StatusBreakdown title="Students by status" rows={data.students.byStatus} total={data.students.total} />
              <StatusBreakdown title="Applications by status" rows={data.admissions.byStatus} total={data.admissions.total} />
              <StatusBreakdown title="Attendance records by status" rows={data.attendance.byStatus} total={data.attendance.marked} />
              <StatusBreakdown title="Fee records by status" rows={data.fees.byStatus} />
              <StatusBreakdown title="Placements by status" rows={data.placement.byStatus} total={data.placement.eligible} />
              <StatusBreakdown title="Faculty hours by workload type" rows={data.faculty.byWorkloadType} total={data.faculty.totalHoursPerWeek} />
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>How to read this page</h2>
            <ul style={{ fontSize: '0.8rem', color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              <li>
                Headcounts (students, faculty, hostel beds) are read from the <em>newest</em> bucket, not
                summed — summing a stock across {data.window.periodCount} buckets would multiply it.
              </li>
              <li>
                Flows (fees, results, placements) are summed over the window, and every rate is re-derived
                from the summed counts rather than averaged, because averaging percentages is not a
                percentage.
              </li>
              <li>
                A gap in a chart means the bucket could not be computed — it is not a zero. Buckets with no
                materialized row are recomputed live and listed in the caption above.
              </li>
              <li>
                Figures come from a rollup refreshed by a worker, so they trail the ledgers by up to a day.
                Tick <strong>Live recompute</strong> (or queue a refresh) when you need them now.
              </li>
            </ul>
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 8 }}>
              This page requires the <code>{ANALYTICS_VIEW_PERMISSION}</code> grant and the{' '}
              <code>analytics.advanced</code> plan entitlement. Both are enforced by the API regardless of
              what the browser renders.
            </p>
          </Card>
        </>
      )}

      {!data && !error && <p style={{ color: '#9ca3af' }}>Loading analytics…</p>}
    </div>
  );
}
