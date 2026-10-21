import React, { useCallback, useEffect, useState } from 'react';
import type { PlatformMaintenanceModeDto } from '@college-erp/types';
import { Badge, Button, Card, Input, useConfirm } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Estate-wide maintenance switch. While it is on, the tenant realm refuses every sign-in with
 * the message below (AuthService checks it before credential work). The platform realm itself is
 * deliberately exempt so an operator can always return here and turn it off.
 */
export function PlatformMaintenancePage() {
  const confirm = useConfirm();
  const [state, setState] = useState<PlatformMaintenanceModeDto | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((next: PlatformMaintenanceModeDto) => {
    setState(next);
    setEnabled(next.enabled);
    setMessage(next.message ?? '');
    setEndsAt(toLocalInput(next.endsAt));
  }, []);

  useEffect(() => {
    platformApiFetch<PlatformMaintenanceModeDto>('/platform/maintenance')
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load maintenance mode.'))
      .finally(() => setLoading(false));
  }, [apply]);

  const save = async () => {
    if (enabled && !state?.enabled) {
      const confirmed = await confirm({
        title: 'Enable maintenance mode?',
        description:
          'Every tenant user will be signed out of new logins across all companies until this is turned off. Platform admins stay signed in.',
        confirmLabel: 'Enable maintenance',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await platformApiFetch<PlatformMaintenanceModeDto>('/platform/maintenance', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          message: message.trim() || undefined,
          endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        }),
      });
      apply(next);
      setNotice(next.enabled ? 'Maintenance mode is now ON. Tenant sign-ins are blocked.' : 'Maintenance mode is OFF. Tenant sign-ins are allowed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save maintenance mode.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: '#64748b' }}>Loading maintenance state…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: '1.3rem', margin: 0, letterSpacing: '-0.02em' }}>Maintenance Mode</h1>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
          Take the tenant estate offline for a migration or incident without touching individual
          companies. The platform console always stays reachable.
        </p>
      </div>

      {(error || notice) && (
        <div
          role="status"
          style={{
            borderRadius: 8,
            padding: '0.6rem 0.8rem',
            fontSize: '0.83rem',
            background: error ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${error ? '#fecaca' : '#bbf7d0'}`,
            color: error ? '#b91c1c' : '#15803d',
          }}
        >
          {error ?? notice}
        </div>
      )}

      <Card
        style={{
          borderColor: (state?.enabled ?? false) ? '#fecaca' : '#bbf7d0',
          background: (state?.enabled ?? false) ? '#fff7f7' : '#f7fdf9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Current state</h2>
              <Badge tone={state?.enabled ? 'danger' : 'success'}>{state?.enabled ? 'Maintenance ON' : 'Operating normally'}</Badge>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#475569' }}>
              {state?.enabled
                ? 'Tenant sign-ins are currently refused. Platform operators can still sign in.'
                : 'Tenant users can sign in normally across every company.'}
            </p>
            {state?.updatedAt && (
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                Last changed {new Date(state.updatedAt).toLocaleString()}
                {state.updatedBy ? ` by operator ${state.updatedBy.slice(0, 10)}…` : ''}
              </p>
            )}
          </div>
          <Button
            variant={state?.enabled ? 'primary' : 'danger'}
            disabled={busy}
            onClick={async () => {
              const next = !(state?.enabled ?? false);
              const confirmed = await confirm({
                title: next ? 'Enable maintenance mode?' : 'Turn maintenance off?',
                description: next
                  ? 'All tenant logins will be refused immediately.'
                  : 'Tenant users will be able to sign in again immediately.',
                confirmLabel: next ? 'Enable' : 'Turn off',
                tone: next ? 'danger' : 'primary',
              });
              if (!confirmed) return;
              setEnabled(next);
              setBusy(true);
              setError(null);
              setNotice(null);
              try {
                const updated = await platformApiFetch<PlatformMaintenanceModeDto>('/platform/maintenance', {
                  method: 'PUT',
                  body: JSON.stringify({ enabled: next, message: message.trim() || undefined }),
                });
                apply(updated);
                setNotice(next ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to change maintenance mode.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {state?.enabled ? 'Turn maintenance off' : 'Enable maintenance'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: 10 }}>Tenant-facing notice</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="maintenance-message" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Message on the sign-in screen
            </label>
            <textarea
              id="maintenance-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="We are performing scheduled maintenance and will be back shortly."
              style={{ padding: '0.55rem', borderRadius: 8, border: '1px solid #cbd5e1', resize: 'vertical', fontSize: '0.88rem' }}
            />
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{message.length}/500</span>
          </div>
          <Input
            label="Expected back (optional)"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button onClick={save} disabled={busy} loading={busy}>
              Save notice
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                apply(state ?? { enabled: false, message: null, endsAt: null, updatedBy: null, updatedAt: null });
                setNotice(null);
                setError(null);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '0.95rem', marginTop: 0, marginBottom: 6 }}>What this switch does</h2>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.83rem', color: '#475569', lineHeight: 1.65 }}>
          <li>Refuses new tenant sign-ins across every company before credentials are checked.</li>
          <li>Does not change each tenant&apos;s status — billing and lifecycle are untouched.</li>
          <li>Does not sign out existing tenant sessions; revoke those per company if needed.</li>
          <li>Never blocks the platform realm. If it did, nobody could turn it off.</li>
        </ul>
      </Card>
    </div>
  );
}
