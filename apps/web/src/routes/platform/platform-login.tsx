import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Input } from '@college-erp/ui';
import { Icon, type IconName } from '../../app/icons';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';

/** Where a successful platform sign-in lands: the company picker, never straight into a tenant. */
export const PLATFORM_HOME = '/platform/select-company';

const CONSOLE_HIGHLIGHTS: Array<{ icon: IconName; title: string; detail: string }> = [
  { icon: 'campuses', title: 'Companies', detail: 'Onboard, suspend and enter any tenant' },
  { icon: 'users', title: 'User Management', detail: 'Platform operators and access' },
  { icon: 'billing', title: 'Billing', detail: 'Plans, subscriptions and invoices' },
  { icon: 'settings', title: 'Maintenance', detail: 'One switch for the whole estate' },
];

const layoutStyles = `
.platform-auth { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); background: #ffffff; }
.platform-auth__brand {
  position: relative; overflow: hidden; display: flex; flex-direction: column;
  padding: 3rem clamp(2rem, 6vw, 5rem); color: #e2e8f0;
  background:
    radial-gradient(900px 500px at 10% -10%, rgba(37, 99, 235, 0.35), transparent 60%),
    radial-gradient(700px 420px at 110% 110%, rgba(14, 165, 233, 0.18), transparent 55%),
    linear-gradient(160deg, #0b1220 0%, #0f172a 55%, #111c31 100%);
}
.platform-auth__grid {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.35;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(180deg, rgba(0,0,0,0.8), transparent 78%);
}
.platform-auth__brand > * { position: relative; }
.platform-auth__mark {
  width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center;
  background: linear-gradient(145deg, #3b82f6, #1d4ed8); color: #fff; font-weight: 800;
  letter-spacing: -0.04em; font-size: 1.05rem; box-shadow: 0 10px 28px rgba(29, 78, 216, 0.45);
}
.platform-auth__wordmark { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; color: #f8fafc; }
.platform-auth__wordmark span { font-weight: 400; color: #93c5fd; }
.platform-auth__eyebrow {
  margin-top: clamp(3rem, 8vh, 5.5rem); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.32em;
  text-transform: uppercase; color: #60a5fa;
}
.platform-auth__headline {
  margin: 0.75rem 0 0; font-size: clamp(2.8rem, 6vw, 4.6rem); line-height: 0.95; letter-spacing: -0.05em;
  font-weight: 800; color: #f8fafc;
}
.platform-auth__lede { margin-top: 1.1rem; max-width: 34ch; font-size: 1rem; line-height: 1.6; color: #94a3b8; }
.platform-auth__panel {
  margin-top: 2.25rem; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(10px); overflow: hidden;
  box-shadow: 0 24px 60px rgba(2, 6, 23, 0.45);
}
.platform-auth__panel-title {
  padding: 0.85rem 1.15rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.22em;
  text-transform: uppercase; color: #cbd5e1; border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(148, 163, 184, 0.06);
}
.platform-auth__row { display: flex; gap: 0.9rem; align-items: flex-start; padding: 0.85rem 1.15rem; border-bottom: 1px solid rgba(148, 163, 184, 0.12); }
.platform-auth__row:last-child { border-bottom: 0; }
.platform-auth__row-icon {
  width: 34px; height: 34px; flex: none; border-radius: 9px; display: grid; place-items: center;
  color: #93c5fd; background: rgba(59, 130, 246, 0.14); border: 1px solid rgba(59, 130, 246, 0.24);
}
.platform-auth__row-title { font-size: 0.9rem; font-weight: 600; color: #e2e8f0; }
.platform-auth__row-detail { font-size: 0.78rem; color: #94a3b8; margin-top: 1px; }
.platform-auth__main { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem 1.5rem; background: #ffffff; }
.platform-auth__card { width: 100%; max-width: 400px; }
.platform-auth__card-title { font-size: 1.65rem; font-weight: 700; letter-spacing: -0.03em; color: #0f172a; margin: 0; }
.platform-auth__card-sub { margin: 0.35rem 0 1.6rem; font-size: 0.88rem; color: #64748b; }
.platform-auth__footer { margin-top: 1.35rem; text-align: center; font-size: 0.8rem; color: #94a3b8; }
.platform-auth__error {
  border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; border-radius: 8px;
  padding: 0.6rem 0.75rem; font-size: 0.82rem; line-height: 1.45;
}
.platform-auth__tf { margin-top: 2.5rem; font-size: 0.72rem; color: rgba(148, 163, 184, 0.7); }
@media (max-width: 900px) {
  .platform-auth { grid-template-columns: 1fr; }
  .platform-auth__brand { padding: 2rem 1.5rem; }
  .platform-auth__eyebrow { margin-top: 1.75rem; }
  .platform-auth__panel { display: none; }
  .platform-auth__main { padding: 2rem 1.25rem 3rem; }
}
`;

/**
 * Superadmin sign-in. This is the platform realm's only public screen — it has no tenant slug
 * field by design (there is no tenant context in this route tree; see lib/platform-http.ts).
 * A successful login lands on the company picker so the operator chooses which workspace to
 * enter instead of being dropped into a tenant by accident.
 */
export function PlatformLoginPage() {
  const { login, status } = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={PLATFORM_HOME} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(PLATFORM_HOME, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="platform-auth">
      <style>{layoutStyles}</style>

      <section className="platform-auth__brand" aria-label="Platform administration">
        <div className="platform-auth__grid" aria-hidden="true" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="platform-auth__mark">CE</div>
          <div>
            <div className="platform-auth__wordmark">
              College<span>ERP</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', letterSpacing: '0.08em' }}>
              SaaS Operations
            </div>
          </div>
        </div>

        <div className="platform-auth__eyebrow">Platform operations console</div>
        <h1 className="platform-auth__headline">CONTROL PLANE</h1>
        <p className="platform-auth__lede">
          The estate-wide console for every college workspace: onboard tenants, manage billing,
          and keep the platform healthy.
        </p>

        <div className="platform-auth__panel">
          <div className="platform-auth__panel-title">Inside the console</div>
          {CONSOLE_HIGHLIGHTS.map((item) => (
            <div className="platform-auth__row" key={item.title}>
              <span className="platform-auth__row-icon">
                <Icon name={item.icon} size={17} />
              </span>
              <span>
                <span className="platform-auth__row-title">{item.title}</span>
                <span className="platform-auth__row-detail">{item.detail}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="platform-auth__tf">Platform administrators and support only.</div>
      </section>

      <main className="platform-auth__main">
        <div className="platform-auth__card">
          <h2 className="platform-auth__card-title">Sign in</h2>
          <p className="platform-auth__card-sub">Use your work email to open the console.</p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="superadmin@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error && (
              <div className="platform-auth__error" role="alert">
                {error}
              </div>
            )}
            <Button type="submit" disabled={submitting} block>
              {submitting ? 'Signing in…' : 'Sign in  →'}
            </Button>
          </form>

          <p className="platform-auth__footer">No account? Contact your platform administrator.</p>
        </div>
      </main>
    </div>
  );
}
