/**
 * @college-erp/analytics - the shared, framework-free metric layer behind both dashboards.
 *
 * Two consumers, one implementation:
 *  - apps/api serves reads from the materialized AnalyticsSnapshot rows and can recompute live
 *    on demand (manager "Refresh" buttons, small tenants with no sweep scheduled yet).
 *  - apps/worker recomputes those same rows on a schedule.
 *
 * Because both sides call the pure functions in this package, a live recompute and a snapshot read
 * cannot disagree. What lives here is only the math and the contracts; all I/O and all RBAC
 * enforcement stay in the applications.
 */

export * from './types';
export * from './periods';
export * from './mrr';
export * from './college';
export * from './rollup';
