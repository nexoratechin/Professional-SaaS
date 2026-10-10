import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '@college-erp/ui';
import type { TenantAuthMethodInfoDto } from '@college-erp/types';
import { useAuth } from '../features/auth/auth-context';
import { brandingAssetUrl, useBranding } from '../features/branding/branding-context';
import { apiFetch } from '../lib/http';

export function LoginPage() {
  const { login, startSso } = useAuth();
  const { branding, previewTenant } = useBranding();
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState(import.meta.env.VITE_DEV_TENANT_SLUG ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [authInfo, setAuthInfo] = useState<TenantAuthMethodInfoDto | null>(null);

  // Preview the tenant's white-label branding (logo, colors, portal name, login copy) as the slug
  // is typed — served by the public branding endpoint, so no credential is required.
  useEffect(() => {
    previewTenant(tenantSlug);
  }, [tenantSlug, previewTenant]);

  // Discover the tenant's SSO providers (and whether local password login is even allowed) as the
  // slug is typed. Failures are silent — the password form remains the fallback, and the API is
  // the real gate.
  useEffect(() => {
    const slug = tenantSlug.trim();
    if (!slug) {
      setAuthInfo(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<TenantAuthMethodInfoDto>('/auth/sso/providers', { tenantSlug: slug, skipAuth: true })
        .then(setAuthInfo)
        .catch(() => setAuthInfo(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [tenantSlug]);

  const localAuthEnabled = authInfo?.localAuthEnabled ?? true;
  const ssoProviders = authInfo?.ssoProviders ?? [];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(tenantSlug, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSso = async (providerKey: string) => {
    setError(null);
    try {
      const authorizationUrl = await startSso(tenantSlug, providerKey, '/dashboard');
      window.location.assign(authorizationUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start single sign-on');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '4rem',
        minHeight: '100vh',
        background: branding?.login.backgroundColor ?? undefined,
      }}
    >
      <Card style={{ width: 380 }}>
        {branding?.logoUrl && (
          <img
            src={brandingAssetUrl(branding.logoUrl) as string}
            alt={branding.portalName}
            style={{ maxHeight: 56, maxWidth: 220, display: 'block', marginBottom: 12 }}
          />
        )}
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>
          {branding?.login.title ?? 'College ERP — Sign in'}
        </h1>
        {(branding?.login.subtitle || branding?.login.welcomeText) && (
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {branding?.login.subtitle ?? branding?.login.welcomeText}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="Tenant slug"
            name="tenantSlug"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            placeholder="e.g. stmarys"
            required
          />

          {ssoProviders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ssoProviders.map((provider) => (
                <Button key={provider.key} type="button" variant="secondary" onClick={() => handleSso(provider.key)}>
                  Sign in with {provider.name}
                </Button>
              ))}
            </div>
          )}

          {!localAuthEnabled ? (
            <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
              Password sign-in is disabled for this organization. Use single sign-on above.
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="Email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          )}

          {!localAuthEnabled && error && <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
        </div>
      </Card>
    </div>
  );
}
