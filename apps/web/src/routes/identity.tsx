import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import type { IdentityProviderDto, IdentityProviderRoleMappingDto } from '@college-erp/types';
import { apiFetch } from '../lib/http';

interface RoleOption {
  id: string;
  code: string;
  name: string;
}

interface CreateFormState {
  key: string;
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedEmailDomains: string;
  autoProvisionUsers: boolean;
  enforceEmailVerified: boolean;
  defaultRoleId: string;
}

const EMPTY_FORM: CreateFormState = {
  key: '',
  name: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  allowedEmailDomains: '',
  autoProvisionUsers: true,
  enforceEmailVerified: true,
  defaultRoleId: '',
};

function toDomains(value: string): string[] {
  return value
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
}

export function IdentityPage() {
  const [providers, setProviders] = useState<IdentityProviderDto[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<IdentityProviderRoleMappingDto[]>([]);
  const [mappingClaimValue, setMappingClaimValue] = useState('');
  const [mappingRoleId, setMappingRoleId] = useState('');
  const [secretDraft, setSecretDraft] = useState('');

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await apiFetch<IdentityProviderDto[]>('/identity/providers'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load identity providers.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMappings = useCallback(async (providerId: string) => {
    try {
      setMappings(await apiFetch<IdentityProviderRoleMappingDto[]>(`/identity/providers/${providerId}/role-mappings`));
    } catch {
      setMappings([]);
    }
  }, []);

  useEffect(() => {
    loadProviders();
    apiFetch<RoleOption[]>('/roles')
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [loadProviders]);

  useEffect(() => {
    if (selectedId) {
      loadMappings(selectedId);
    }
  }, [selectedId, loadMappings]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiFetch('/identity/providers', {
        method: 'POST',
        body: JSON.stringify({
          key: form.key,
          name: form.name,
          issuer: form.issuer,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          allowedEmailDomains: toDomains(form.allowedEmailDomains),
          autoProvisionUsers: form.autoProvisionUsers,
          enforceEmailVerified: form.enforceEmailVerified,
          defaultRoleId: form.defaultRoleId || undefined,
        }),
      });
      setForm(EMPTY_FORM);
      await loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create identity provider.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Single sign-on (SSO)</h1>
      {error && <div style={{ color: '#dc2626', fontSize: '0.9rem' }}>{error}</div>}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Identity providers</h2>
        {loading && <p style={{ color: '#6b7280' }}>Loading…</p>}
        {!loading && providers.length === 0 && <p style={{ color: '#6b7280' }}>No identity providers configured.</p>}
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {providers.map((provider) => (
            <li
              key={provider.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <span>
                <strong>{provider.name}</strong>{' '}
                <span style={{ color: '#6b7280' }}>
                  ({provider.key} · {provider.status} · {provider.issuer}
                  {provider.hasClientSecret ? '' : ' · ⚠ no secret'})
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => setSelectedId(provider.id)}>
                  Manage mappings
                </Button>
                {provider.status !== 'ACTIVE' && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      run(async () => {
                        await apiFetch(`/identity/providers/${provider.id}/status`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'ACTIVE' }),
                        });
                        await loadProviders();
                      })
                    }
                  >
                    Activate
                  </Button>
                )}
                {provider.status === 'ACTIVE' && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      run(async () => {
                        await apiFetch(`/identity/providers/${provider.id}/status`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'DISABLED' }),
                        });
                        await loadProviders();
                      })
                    }
                  >
                    Disable
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm(`Delete identity provider "${provider.name}"?`)) {
                        return;
                      }
                      await apiFetch(`/identity/providers/${provider.id}`, { method: 'DELETE' });
                      if (selectedId === provider.id) {
                        setSelectedId(null);
                      }
                      await loadProviders();
                    })
                  }
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {selected && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>“{selected.name}” — group → role mappings</h2>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 8 }}>
            Each mapping grants a local role when the IdP asserts the given value in the claim (default
            &quot;groups&quot;). Multiple matches grant all matched roles.
          </p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {mappings.length === 0 && <li style={{ color: '#6b7280' }}>No mappings.</li>}
            {mappings.map((mapping) => (
              <li key={mapping.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>
                  <code>{mapping.claimName}</code> = <strong>{mapping.claimValue}</strong> →{' '}
                  {mapping.roleName ?? mapping.roleCode ?? mapping.roleId}
                </span>
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      await apiFetch(`/identity/providers/${selected.id}/role-mappings/${mapping.id}`, {
                        method: 'DELETE',
                      });
                      await loadMappings(selected.id);
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await apiFetch(`/identity/providers/${selected.id}/role-mappings`, {
                  method: 'POST',
                  body: JSON.stringify({ claimValue: mappingClaimValue, roleId: mappingRoleId }),
                });
                setMappingClaimValue('');
                await loadMappings(selected.id);
              });
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <Input
              label="Claim value (e.g. faculty)"
              name="claimValue"
              value={mappingClaimValue}
              onChange={(e) => setMappingClaimValue(e.target.value)}
              required
            />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
              Role
              <select value={mappingRoleId} onChange={(e) => setMappingRoleId(e.target.value)} required>
                <option value="">Select…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({role.code})
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Add mapping</Button>
          </form>

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
          <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Rotate client secret</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await apiFetch(`/identity/providers/${selected.id}/secret`, {
                  method: 'PATCH',
                  body: JSON.stringify({ clientSecret: secretDraft }),
                });
                setSecretDraft('');
                await loadProviders();
              });
            }}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <Input
              label="New client secret"
              name="clientSecret"
              type="password"
              value={secretDraft}
              onChange={(e) => setSecretDraft(e.target.value)}
              required
            />
            <Button type="submit">Update secret</Button>
          </form>
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Add an OIDC provider</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
          <Input label="Key" name="key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="azure-ad" required />
          <Input label="Display name" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Azure AD" required />
          <Input label="Issuer URL" name="issuer" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" required />
          <Input label="Client ID" name="clientId" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required />
          <Input label="Client secret" name="clientSecret" type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required />
          <Input
            label="Allowed email domains (comma-separated, blank = any)"
            name="allowedEmailDomains"
            value={form.allowedEmailDomains}
            onChange={(e) => setForm({ ...form, allowedEmailDomains: e.target.value })}
            placeholder="college.edu, alumni.college.edu"
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            Default role for provisioned users
            <select value={form.defaultRoleId} onChange={(e) => setForm({ ...form, defaultRoleId: e.target.value })}>
              <option value="">None</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.code})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.autoProvisionUsers}
              onChange={(e) => setForm({ ...form, autoProvisionUsers: e.target.checked })}
            />
            Automatically provision users on first sign-in
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.enforceEmailVerified}
              onChange={(e) => setForm({ ...form, enforceEmailVerified: e.target.checked })}
            />
            Require a verified email from the provider
          </label>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create provider'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
