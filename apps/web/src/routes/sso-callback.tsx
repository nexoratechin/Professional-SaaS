import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';

/**
 * Landing page for the SSO redirect. The callback endpoint on the API has already exchanged the
 * code and either set a refresh cookie (success), minted an MFA challenge (mfa), or bounced back
 * with an error — no tokens ever appear in this URL. On success/first load we exchange the cookie
 * for an access token via establishSession; on the MFA path we ask for a code and redeem the
 * challenge.
 */
export function SsoCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { establishSession, verifyMfaChallenge } = useAuth();

  const status = params.get('status') ?? 'error';
  const tenantSlug = params.get('tenant') ?? localStorage.getItem('college_erp_tenant_slug') ?? '';
  const returnTo = params.get('returnTo') || '/dashboard';
  const challengeToken = params.get('challenge') ?? '';

  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status !== 'success') {
      return;
    }
    establishSession(tenantSlug)
      .then(() => navigate(returnTo, { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Sign-in could not be completed.'));
  }, [status, tenantSlug, returnTo, establishSession, navigate]);

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
        <Card style={{ width: 420 }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Sign-in failed</h1>
          <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>
            Single sign-on could not be completed ({params.get('code') ?? 'unknown_error'}).
          </p>
          <Button onClick={() => navigate('/login', { replace: true })}>Back to sign in</Button>
        </Card>
      </div>
    );
  }

  if (status === 'mfa') {
    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        await verifyMfaChallenge(tenantSlug, challengeToken, code);
        navigate(returnTo, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verification failed');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
        <Card style={{ width: 360 }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Two-factor verification</h1>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input
              label="Authentication code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
            />
            {error && <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
      <Card style={{ width: 360 }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Completing sign-in…</h1>
        {error ? (
          <>
            <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>{error}</p>
            <Button onClick={() => navigate('/login', { replace: true })}>Back to sign in</Button>
          </>
        ) : (
          <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Please wait.</p>
        )}
      </Card>
    </div>
  );
}
