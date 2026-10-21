import React, { useCallback, useEffect, useState } from 'react';
import type { PlatformOperatorDto } from '@college-erp/types';
import { Badge, Button, Card, Input, Modal } from '@college-erp/ui';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';
import { platformApiFetch } from '../../lib/platform-http';

/**
 * "User Management" for the control plane: the platform's own operators, not tenant users.
 * Tenant users are managed inside each company's console (Users tab) because they belong to
 * that tenant's data. Every mutation here is admin-only on both the client and the API.
 */
export function PlatformUsersPage() {
  const { platformUser } = usePlatformAuth();
  const [users, setUsers] = useState<PlatformOperatorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<PlatformOperatorDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await platformApiFetch<PlatformOperatorDto[]>('/platform/users'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform operators.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateUser = (user: PlatformOperatorDto, patch: { role?: PlatformOperatorDto['role']; isActive?: boolean }) =>
    mutate(
      () => platformApiFetch(`/platform/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      `${user.fullName} updated.`,
    );

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      () =>
        platformApiFetch('/platform/users', {
          method: 'POST',
          body: JSON.stringify({
            email: String(form.get('email') ?? ''),
            fullName: String(form.get('fullName') ?? ''),
            role: String(form.get('role') ?? 'PLATFORM_SUPPORT'),
            password: String(form.get('password') ?? ''),
          }),
        }),
      'Platform operator created.',
    );
    setCreateOpen(false);
  };

  const handleResetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetTarget) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      () =>
        platformApiFetch(`/platform/users/${resetTarget.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ password: String(form.get('password') ?? '') }),
        }),
      `Password reset for ${resetTarget.email}. Their sessions were revoked.`,
    );
    setResetTarget(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', margin: 0, letterSpacing: '-0.02em' }}>User Management</h1>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Platform operators who can sign in to this console. Tenant users are managed inside each
            company workspace.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Add operator</Button>
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

      <Card>
        {loading ? (
          <p style={{ color: '#64748b' }}>Loading operators…</p>
        ) : users.length === 0 ? (
          <p style={{ color: '#64748b' }}>No platform operators found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '8px' }}>Operator</th>
                  <th style={{ padding: '8px' }}>Role</th>
                  <th style={{ padding: '8px' }}>MFA</th>
                  <th style={{ padding: '8px' }}>Status</th>
                  <th style={{ padding: '8px' }}>Created</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === platformUser?.id;
                  return (
                    <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {user.fullName}
                          {isSelf && (
                            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#2563eb', fontWeight: 600 }}>you</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{user.email}</div>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          aria-label={`Role for ${user.email}`}
                          value={user.role}
                          disabled={isSelf || busy}
                          onChange={(event) => updateUser(user, { role: event.target.value as PlatformOperatorDto['role'] })}
                          style={{ padding: '0.28rem 0.4rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                        >
                          <option value="PLATFORM_ADMIN">Platform Admin</option>
                          <option value="PLATFORM_SUPPORT">Platform Support</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <Badge tone={user.mfaEnabled ? 'success' : 'neutral'}>{user.mfaEnabled ? 'Enabled' : 'Off'}</Badge>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <Badge tone={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'Active' : 'Disabled'}</Badge>
                      </td>
                      <td style={{ padding: '8px' }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => setResetTarget(user)}>
                          Reset password
                        </Button>
                        <Button
                          variant={user.isActive ? 'ghost' : 'secondary'}
                          size="sm"
                          disabled={isSelf || busy}
                          onClick={() => updateUser(user, { isActive: !user.isActive })}
                        >
                          {user.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '0.95rem', marginTop: 0, marginBottom: 6 }}>How access works</h2>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.83rem', color: '#475569', lineHeight: 1.6 }}>
          <li><strong>Platform Admin</strong> — full control plane: companies, billing, plans, operators, maintenance.</li>
          <li><strong>Platform Support</strong> — read-only triage: dashboard, analytics, tenant lookup, support tickets.</li>
          <li>Disabling an operator or resetting their password revokes their platform sessions immediately.</li>
          <li>The last active Platform Admin cannot be disabled or demoted.</li>
        </ul>
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add platform operator" size="sm">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Full name" name="fullName" required />
          <Input label="Email" name="email" type="email" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Role</label>
            <select name="role" defaultValue="PLATFORM_SUPPORT" style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              <option value="PLATFORM_SUPPORT">Platform Support</option>
              <option value="PLATFORM_ADMIN">Platform Admin</option>
            </select>
          </div>
          <Input label="Initial password" name="password" type="password" minLength={8} required />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Create operator
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={resetTarget !== null} onClose={() => setResetTarget(null)} title="Reset password" size="sm">
        <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569' }}>
            Set a new password for <strong>{resetTarget?.email}</strong>. Their existing platform sessions will be
            revoked.
          </p>
          <Input label="New password" name="password" type="password" minLength={8} required />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Reset password
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
