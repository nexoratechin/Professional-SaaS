import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '@college-erp/ui';
import { apiFetch } from '../../lib/http';
import { usePwa } from './pwa-context';

/** Scoped styles for the PWA chrome (offline/update/install banners, mobile tab bar, push). */
export const PWA_CSS = `
.pwa-offline { position: sticky; top: 0; z-index: 40; background: #b45309; color: #fff; font-size: 0.82rem; padding: 6px 12px; text-align: center; }
.pwa-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 84px; z-index: 50; background: #0f172a; color: #fff; border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; box-shadow: 0 12px 30px rgba(15,23,42,0.35); font-size: 0.85rem; max-width: calc(100vw - 24px); }
.pwa-toast button { background: #4f46e5; color: #fff; border: 0; border-radius: 8px; padding: 6px 12px; font-weight: 600; cursor: pointer; }
.pwa-install { position: fixed; left: 12px; right: 12px; bottom: 84px; z-index: 50; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; display: flex; align-items: center; gap: 12px; box-shadow: 0 12px 30px rgba(15,23,42,0.18); }
.pwa-install .pwa-install-body { flex: 1; min-width: 0; }
.pwa-install strong { display: block; font-size: 0.95rem; }
.pwa-install span { color: #64748b; font-size: 0.8rem; }
.pwa-tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; background: #fff; border-top: 1px solid #e5e7eb; display: flex; padding-bottom: env(safe-area-inset-bottom); }
.pwa-tabbar a { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; color: #64748b; text-decoration: none; font-size: 0.68rem; font-weight: 600; }
.pwa-tabbar a.pwa-tab-active { color: #4f46e5; }
.pwa-tabbar svg { width: 22px; height: 22px; }
.pwa-push-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
@media (min-width: 768px) { .pwa-tabbar { display: none; } .pwa-install, .pwa-toast { bottom: 20px; left: auto; right: 20px; left: auto; transform: none; max-width: 380px; } .pwa-install { left: auto; right: 20px; } }
@media (max-width: 767px) { .sp-main { padding-bottom: 88px; } }
`;

/** Banners + update affordance. Rendered by the portal/faculty/parent shells. */
export function PwaChrome() {
  const { isOnline, updateAvailable, applyUpdate, canInstall, promptInstall, dismissInstall } = usePwa();
  const [offlineDismissed, setOfflineDismissed] = useState(false);

  return (
    <>
      <style>{PWA_CSS}</style>
      {!isOnline && !offlineDismissed && (
        <div className="pwa-offline" role="status">
          You're offline — showing saved data where available.{' '}
          <button
            type="button"
            onClick={() => setOfflineDismissed(true)}
            style={{ background: 'transparent', border: 0, color: '#fff', textDecoration: 'underline', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}
      {updateAvailable && (
        <div className="pwa-toast" role="status">
          <span>A new version is available.</span>
          <button type="button" onClick={applyUpdate}>
            Refresh
          </button>
        </div>
      )}
      {canInstall && (
        <div className="pwa-install">
          <div className="pwa-install-body">
            <strong>Install College ERP</strong>
            <span>Add the app to your home screen for offline access and faster launch.</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Button onClick={() => void promptInstall()}>Install</Button>
            <Button variant="secondary" onClick={dismissInstall}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** Bottom tab bar for the mobile shell. Hidden on ≥768px where the top nav is used. */
export function MobileTabBar({
  items,
}: {
  items: Array<{ to: string; label: string; icon: React.ReactNode }>;
}) {
  return (
    <nav className="pwa-tabbar" aria-label="Primary">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? 'pwa-tab-active' : undefined)}
        >
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const ICON_PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  id: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm5 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-3 8h6a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2zm8-6h5v2h-5zm0 4h5v2h-5z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  calendar: 'M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 8v9H5v-9z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-5-2-3V9a5 5 0 1 0-10 0v5l-2 3v1h14z',
  book: 'M5 3h11a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zm0 2v13a1 1 0 0 0 1 1h11V6a1 1 0 0 0-1-1z',
  wallet: 'M3 6a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm14 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a7 7 0 0 1 14 0v1H2zm16 1v-1c0-1.3-.3-2.5-.9-3.6A6 6 0 0 1 22 20v1z',
};

export function TabIcon({ name }: { name: keyof typeof ICON_PATHS | string }) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.home;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

interface PushConfig {
  enabled: boolean;
  vapidPublicKey: string | null;
}

/** Self-service push opt-in for any authenticated role. Renders nothing when the server has no
 *  VAPID keys or the browser can't do Web Push, so it never shows a dead control. */
export function PushToggle() {
  const { pushSupported, pushSubscribed, enablePushNotifications, disablePushNotifications } = usePwa();
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PushConfig>('/push/config')
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false, vapidPublicKey: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pushSupported || !config?.enabled || !config.vapidPublicKey) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (pushSubscribed) {
        await disablePushNotifications();
        setMessage('Push notifications turned off on this device.');
      } else {
        await enablePushNotifications(config.vapidPublicKey as string);
        setMessage('Push notifications enabled on this device.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update push notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-stat">
      <div className="pwa-push-row">
        <div>
          <div style={{ fontWeight: 600 }}>Push notifications</div>
          <div className="sp-muted">
            {pushSubscribed ? 'Enabled on this device.' : 'Get alerts for notices, results and attendance.'}
          </div>
        </div>
        <Button variant={pushSubscribed ? 'secondary' : 'primary'} onClick={() => void toggle()} disabled={busy}>
          {busy ? 'Working…' : pushSubscribed ? 'Disable' : 'Enable'}
        </Button>
      </div>
      {message && <p style={{ color: '#15803d', margin: '8px 0 0', fontSize: '0.85rem' }}>{message}</p>}
      {error && <p style={{ color: '#b91c1c', margin: '8px 0 0', fontSize: '0.85rem' }}>{error}</p>}
    </div>
  );
}
