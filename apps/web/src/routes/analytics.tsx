import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { useEntitlement } from '../features/auth/auth-context';

/** Demo page gated behind the `analytics.advanced` granular entitlement — reached only when the
 * route's EntitlementRoute wrapper passes (and the backend EntitlementFlagsGuard would reject any
 * direct API call regardless). Proves navigation-level entitlement enforcement end-to-end. */
export function AdvancedAnalyticsPage() {
  // Belt-and-braces in-page guard even when reached via a direct URL that bypassed the wrapper:
  // the wrapper already redirects, but the hook keeps the component honest.
  const enabled = useEntitlement('analytics.advanced');
  if (!enabled) {
    return null;
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link to="/dashboard">&larr; Dashboard</Link>
      <Card>
        <h1 style={{ fontSize: '1.25rem' }}>Advanced Analytics</h1>
        <p>This page is only reachable when the tenant is entitled to <code>analytics.advanced</code>.</p>
      </Card>
    </div>
  );
}