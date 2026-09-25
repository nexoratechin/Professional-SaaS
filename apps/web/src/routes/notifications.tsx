import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import { fmtDateTime } from './helpdesk-shared';

export const NOTIFICATIONS_VIEW_PERMISSION = 'notifications.read';
export const NOTIFICATIONS_SEND_PERMISSION = 'notifications.send';
export const NOTIFICATIONS_TEMPLATES_MANAGE_PERMISSION = 'notifications.templates.manage';
export const NOTIFICATIONS_CAMPAIGNS_MANAGE_PERMISSION = 'notifications.campaigns.manage';
export const NOTIFICATIONS_TRIGGERS_MANAGE_PERMISSION = 'notifications.triggers.manage';
export const NOTIFICATIONS_CONFIG_MANAGE_PERMISSION = 'notifications.config.manage';

const CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
const STATUSES = ['PENDING', 'QUEUED', 'SENT', 'SUPPRESSED', 'FAILED'] as const;
const AUDIENCE_TYPES = ['ALL', 'ROLES', 'DEPARTMENTS', 'CAMPUSES', 'BATCHES', 'STUDENTS', 'USERS'] as const;
/** Provider names the worker recognizes per channel — mirrors the API DTO validation. */
const PROVIDERS_BY_CHANNEL: Record<string, readonly string[]> = {
  EMAIL: ['smtp', 'console'],
  SMS: ['http', 'console'],
  WHATSAPP: ['http', 'console'],
  PUSH: ['http', 'console'],
  IN_APP: ['in_app'],
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  QUEUED: '#2563eb',
  SENT: '#15803d',
  SUPPRESSED: '#6b7280',
  FAILED: '#b91c1c',
};

const CHANNEL_COLORS: Record<string, string> = {
  EMAIL: '#2563eb',
  SMS: '#7c3aed',
  WHATSAPP: '#15803d',
  PUSH: '#db2777',
  IN_APP: '#374151',
};

const CAMPAIGN_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  SCHEDULED: '#2563eb',
  RUNNING: '#f59e0b',
  COMPLETED: '#15803d',
  CANCELED: '#6b7280',
  FAILED: '#b91c1c',
};

type Tab = 'inbox' | 'summary' | 'preferences' | 'templates' | 'campaigns' | 'triggers' | 'providers';

const th: React.CSSProperties = { padding: 8, textAlign: 'left' };
const td: React.CSSProperties = { padding: 8, verticalAlign: 'top' };

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
          {head.map((h) => (
            <th key={h} style={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Badge({ value, colors }: { value: string; colors: Record<string, string> }) {
  return <span style={{ color: colors[value] ?? '#374151', fontWeight: 600 }}>{value.replace(/_/g, ' ')}</span>;
}

function StatGrid({ cards }: { cards: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
      {cards.map((c) => (
        <Card key={c.label} style={{ padding: '0.75rem 1rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{c.label}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: c.color ?? '#111827' }}>{c.value}</div>
        </Card>
      ))}
    </div>
  );
}

interface NotificationRow {
  id: string;
  tenantId: string;
  recipientUserId: string | null;
  channel: string;
  subject: string;
  body: string;
  templateId: string | null;
  campaignId: string | null;
  scheduledAt: string | null;
  status: string;
  error: string | null;
  provider: string | null;
  providerMessageId: string | null;
  attempts: number;
  readAt: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryLogRow {
  id: string;
  attempt: number;
  channel: string;
  provider: string;
  status: string;
  providerMessageId: string | null;
  error: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface NotificationDetail extends NotificationRow {
  deliveryLogs: DeliveryLogRow[];
}

interface SummaryPayload {
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  total: number;
  failed: number;
  pending: number;
}

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  channel: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CampaignTemplateRef {
  id: string;
  name: string;
  code: string;
  channel: string;
}

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  audienceCount: number | null;
  audienceFilter: unknown;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  template: CampaignTemplateRef;
}

interface TriggerRow {
  id: string;
  eventKey: string;
  isActive: boolean;
  createdAt: string;
  template: CampaignTemplateRef;
}

interface ProviderConfigRow {
  id: string;
  channel: string;
  provider: string;
  name: string | null;
  config: Record<string, unknown> | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PreferenceRow {
  id: string;
  channel: string;
  enabled: boolean;
  updatedAt: string;
}

interface PushDeviceRow {
  id: string;
  deviceToken: string;
  platform: string;
  lastSeenAt: string | null;
  createdAt: string;
}

/** Fetches users when the caller holds users.view; otherwise returns null (fall back to a raw id). */
function useUserDirectory(): { id: string; fullName: string }[] | null {
  const [users, setUsers] = useState<{ id: string; fullName: string }[] | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ id: string; fullName: string }[]>('/users?take=500')
      .then((rows) => {
        if (mounted) setUsers(rows);
      })
      .catch(() => {
        if (mounted) setUsers(null);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return users;
}

export function NotificationsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('inbox');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canView = permissions.includes(NOTIFICATIONS_VIEW_PERMISSION);
  const canSend = permissions.includes(NOTIFICATIONS_SEND_PERMISSION);
  const canManageTemplates = permissions.includes(NOTIFICATIONS_TEMPLATES_MANAGE_PERMISSION);
  const canManageCampaigns = permissions.includes(NOTIFICATIONS_CAMPAIGNS_MANAGE_PERMISSION);
  const canManageTriggers = permissions.includes(NOTIFICATIONS_TRIGGERS_MANAGE_PERMISSION);
  const canManageConfig = permissions.includes(NOTIFICATIONS_CONFIG_MANAGE_PERMISSION);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view notifications.</p>;
  }

  const tabs: { key: Tab; label: string; shown: boolean }[] = [
    { key: 'inbox', label: 'Inbox', shown: true },
    { key: 'summary', label: 'Summary', shown: true },
    { key: 'preferences', label: 'Preferences', shown: true },
    { key: 'templates', label: 'Templates', shown: canManageTemplates || canView },
    { key: 'campaigns', label: 'Campaigns', shown: canManageCampaigns || canView },
    { key: 'triggers', label: 'Event triggers', shown: canManageTriggers || canView },
    { key: 'providers', label: 'Providers', shown: canManageConfig },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Notifications</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.filter((t) => t.shown).map((t) => (
            <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'inbox' && <InboxTab canSend={canSend} onError={setError} onNotice={setNotice} />}
      {tab === 'summary' && <SummaryTab onError={setError} />}
      {tab === 'preferences' && <PreferencesTab onError={setError} onNotice={setNotice} />}
      {tab === 'templates' && <TemplatesTab canManage={canManageTemplates} onError={setError} onNotice={setNotice} />}
      {tab === 'campaigns' && <CampaignsTab canManage={canManageCampaigns} onError={setError} onNotice={setNotice} />}
      {tab === 'triggers' && <TriggersTab canManage={canManageTriggers} onError={setError} onNotice={setNotice} />}
      {tab === 'providers' && <ProvidersTab canManage={canManageConfig} onError={setError} onNotice={setNotice} />}
    </div>
  );
}

// ── Inbox ────────────────────────────────────────────────────────────────────

function InboxTab({ canSend, onError, onNotice }: { canSend: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filters, setFilters] = useState({ status: '', channel: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const users = useUserDirectory();

  const load = useCallback(async () => {
    onError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('take', '100');
      if (filters.status) qs.set('status', filters.status);
      if (filters.channel) qs.set('channel', filters.channel);
      setRows(await apiFetch<NotificationRow[]>(`/notifications?${qs.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load notifications.');
    }
  }, [onError, filters.status, filters.channel]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Status</label>
            <select style={selectStyle} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Channel</label>
            <select style={selectStyle} value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
              <option value="">All</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Button variant="secondary" onClick={() => void load()}>Apply</Button>
          {canSend && <Button onClick={() => setShowSend((v) => !v)}>{showSend ? 'Cancel' : 'Send notification'}</Button>}
        </div>
      </Card>

      {showSend && (
        <SendForm users={users} onError={onError} onNotice={onNotice} onSent={() => void load()} />
      )}

      {selected ? (
        <NotificationDetailPanel
          notificationId={selected}
          onError={onError}
          onNotice={onNotice}
          onBack={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : (
        <Card>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>{rows.length} notification(s)</p>
          <Table head={['Channel', 'Subject', 'Status', 'Attempts', 'Provider', 'Scheduled', 'Created', '']}>
            {rows.map((n) => (
              <tr key={n.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={n.channel} colors={CHANNEL_COLORS} /></td>
                <td style={td}>{n.subject}</td>
                <td style={td}><Badge value={n.status} colors={STATUS_COLORS} /></td>
                <td style={td}>{n.attempts}</td>
                <td style={td}>{n.provider ?? '—'}</td>
                <td style={td}>{n.scheduledAt ? fmtDateTime(n.scheduledAt) : '—'}</td>
                <td style={td}>{fmtDateTime(n.createdAt)}</td>
                <td style={td}><Button variant="secondary" onClick={() => setSelected(n.id)}>Open</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function SendForm({ users, onError, onNotice, onSent }: { users: { id: string; fullName: string }[] | null; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onSent: () => void }) {
  const [form, setForm] = useState({ recipientUserId: '', channel: 'IN_APP', subject: '', body: '', scheduledAt: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const body: Record<string, unknown> = {
        recipientUserId: form.recipientUserId,
        channel: form.channel,
        subject: form.subject,
        body: form.body,
      };
      if (form.scheduledAt) body.scheduledAt = form.scheduledAt;
      await apiFetch('/notifications', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Notification queued for delivery.');
      setForm({ recipientUserId: '', channel: 'IN_APP', subject: '', body: '', scheduledAt: '' });
      onSent();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to queue notification.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Send a notification</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {users ? (
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Recipient</label>
            <select style={selectStyle} value={form.recipientUserId} onChange={(e) => setForm({ ...form, recipientUserId: e.target.value })}>
              <option value="">Select…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </div>
        ) : (
          <Input label="Recipient user id" value={form.recipientUserId} onChange={(e) => setForm({ ...form, recipientUserId: e.target.value })} />
        )}
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Channel</label>
          <select style={selectStyle} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <Input label="Scheduled at (optional, ISO-8601)" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: '0.85rem', color: '#374151' }}>Body</label>
        <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <Button disabled={busy || !form.recipientUserId || !form.subject || !form.body} onClick={submit}>Queue notification</Button>
      </div>
    </Card>
  );
}

function NotificationDetailPanel({ notificationId, onError, onNotice, onBack }: { notificationId: string; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onBack: () => void }) {
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const { permissions } = useAuth();
  const canSend = permissions.includes(NOTIFICATIONS_SEND_PERMISSION);

  const load = useCallback(async () => {
    onError(null);
    try {
      setDetail(await apiFetch<NotificationDetail>(`/notifications/${notificationId}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load notification.');
    }
  }, [notificationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return <Card><p>Loading…</p></Card>;

  const act = async (path: string, success: string, refresh = true) => {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({}) });
      onNotice(success);
      onError(null);
      if (refresh) await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem' }}>{detail.subject}</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            <Badge value={detail.channel} colors={CHANNEL_COLORS} /> · <Badge value={detail.status} colors={STATUS_COLORS} /> · attempts {detail.attempts} · created {fmtDateTime(detail.createdAt)}
          </p>
          {detail.error && <p style={{ fontSize: '0.85rem', color: '#b91c1c' }}>Last error: {detail.error}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {detail.channel === 'IN_APP' && !detail.readAt && <Button variant="secondary" onClick={() => void act(`/notifications/${detail.id}/read`, 'Marked as read.')}>Mark read</Button>}
          {detail.status === 'FAILED' && canSend && <Button onClick={() => void act(`/notifications/${detail.id}/retry`, 'Retry queued.')}>Retry</Button>}
          <Button variant="secondary" onClick={onBack}>Back to list</Button>
        </div>
      </div>

      <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{detail.body}</p>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Delivery log</h3>
        <Table head={['Attempt', 'Provider', 'Status', 'Message id', 'Latency', 'Error', 'When']}>
          {detail.deliveryLogs.map((l) => (
            <tr key={l.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>#{l.attempt}</td>
              <td style={td}>{l.provider}</td>
              <td style={td}><Badge value={l.status} colors={STATUS_COLORS} /></td>
              <td style={td}>{l.providerMessageId ?? '—'}</td>
              <td style={td}>{l.latencyMs != null ? `${l.latencyMs} ms` : '—'}</td>
              <td style={td}>{l.error ?? '—'}</td>
              <td style={td}>{fmtDateTime(l.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function SummaryTab({ onError }: { onError: (m: string | null) => void }) {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);

  useEffect(() => {
    onError(null);
    apiFetch<SummaryPayload>('/notifications/summary')
      .then(setSummary)
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load summary.'));
  }, [onError]);

  if (!summary) return null;

  return (
    <>
      <StatGrid
        cards={[
          { label: 'Total sent', value: String(summary.total) },
          { label: 'Pending / queued', value: String(summary.pending), color: summary.pending > 0 ? '#f59e0b' : '#15803d' },
          { label: 'Failed', value: String(summary.failed), color: summary.failed > 0 ? '#b91c1c' : '#15803d' },
          ...STATUSES.map((s) => ({ label: s, value: String(summary.byStatus[s] ?? 0), color: STATUS_COLORS[s] })),
        ]}
      />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By status</h2>
          <Table head={['Status', 'Count']}>
            {STATUSES.map((s) => (
              <tr key={s} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={s} colors={STATUS_COLORS} /></td>
                <td style={td}>{summary.byStatus[s] ?? 0}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By channel</h2>
          <Table head={['Channel', 'Count']}>
            {CHANNELS.map((c) => (
              <tr key={c} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={c} colors={CHANNEL_COLORS} /></td>
                <td style={td}>{summary.byChannel[c] ?? 0}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}

// ── Preferences ──────────────────────────────────────────────────────────────

function PreferencesTab({ onError, onNotice }: { onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [prefs, setPrefs] = useState<PreferenceRow[]>([]);
  const [devices, setDevices] = useState<PushDeviceRow[]>([]);
  const [token, setToken] = useState('');
  const [platform, setPlatform] = useState('web');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      const [p, d] = await Promise.all([apiFetch<PreferenceRow[]>('/notifications/preferences'), apiFetch<PushDeviceRow[]>('/notifications/push-devices')]);
      setPrefs(p);
      setDevices(d);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load preferences.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (channel: string, enabled: boolean) => {
    try {
      await apiFetch('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ channel, enabled }) });
      onNotice(`${channel} ${enabled ? 'enabled' : 'disabled'}.`);
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update preference.');
    }
  };

  const register = async () => {
    setBusy(true);
    try {
      await apiFetch('/notifications/push-devices', { method: 'POST', body: JSON.stringify({ deviceToken: token, platform }) });
      onNotice('Push device registered.');
      onError(null);
      setToken('');
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to register device.');
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (id: string) => {
    try {
      await apiFetch(`/notifications/push-devices/${id}`, { method: 'DELETE' });
      onNotice('Push device removed.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove device.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Channel preferences</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 10 }}>
          Absent rows default to enabled. Toggling a channel off suppresses delivery to you on that channel (recorded as SUPPRESSED).
        </p>
        <Table head={['Channel', 'Enabled', 'Updated', '']}>
          {CHANNELS.map((c) => {
            const row = prefs.find((p) => p.channel === c);
            const enabled = row?.enabled ?? true;
            return (
              <tr key={c} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={c} colors={CHANNEL_COLORS} /></td>
                <td style={td}><span style={{ color: enabled ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{enabled ? 'enabled' : 'disabled'}</span></td>
                <td style={td}>{row ? fmtDateTime(row.updatedAt) : '—'}</td>
                <td style={td}>
                  <Button variant="secondary" onClick={() => void toggle(c, !enabled)}>{enabled ? 'Disable' : 'Enable'}</Button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Push devices</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input label="Device token" value={token} onChange={(e) => setToken(e.target.value)} />
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Platform</label>
            <select style={selectStyle} value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="web">Web</option>
            </select>
          </div>
          <Button disabled={busy || !token} onClick={() => void register()}>Register device</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <Table head={['Platform', 'Token', 'Last seen', '']}>
            {devices.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{d.platform}</td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>{d.deviceToken}</td>
                <td style={td}>{d.lastSeenAt ? fmtDateTime(d.lastSeenAt) : '—'}</td>
                <td style={td}><Button variant="secondary" onClick={() => void removeDevice(d.id)}>Remove</Button></td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────

function TemplatesTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [form, setForm] = useState({ code: '', name: '', channel: 'IN_APP', subjectTemplate: '', bodyTemplate: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows(await apiFetch<TemplateRow[]>('/notifications/templates'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load templates.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        channel: form.channel,
        subjectTemplate: form.subjectTemplate,
        bodyTemplate: form.bodyTemplate,
      };
      if (form.description) body.description = form.description;
      await apiFetch('/notifications/templates', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Template created.');
      setForm({ code: '', name: '', channel: 'IN_APP', subjectTemplate: '', bodyTemplate: '', description: '' });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create template.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (t: TemplateRow, isActive: boolean) => {
    try {
      await apiFetch(`/notifications/templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      onNotice(`Template ${isActive ? 'activated' : 'deactivated'}.`);
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update template.');
    }
  };

  const remove = async (t: TemplateRow) => {
    try {
      await apiFetch(`/notifications/templates/${t.id}`, { method: 'DELETE' });
      onNotice('Template archived.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to archive template.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New template</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Channel</label>
              <select style={selectStyle} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input label="Subject template ({{variables}})" value={form.subjectTemplate} onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })} style={{ minWidth: 320 }} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Body template ({'{{variables}}'})</label>
            <textarea value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} rows={4} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Button disabled={busy || !form.code || !form.name || !form.subjectTemplate || !form.bodyTemplate} onClick={create}>Create template</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Code', 'Name', 'Channel', 'Subject', 'Active', 'Updated', '']}>
          {rows.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{t.code}</td>
              <td style={td}>{t.name}</td>
              <td style={td}><Badge value={t.channel} colors={CHANNEL_COLORS} /></td>
              <td style={td}>{t.subjectTemplate}</td>
              <td style={td}>{t.isActive ? 'Yes' : 'No'}</td>
              <td style={td}>{fmtDate(t.updatedAt)}</td>
              <td style={td}>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => void setActive(t, !t.isActive)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                    <Button variant="secondary" onClick={() => void remove(t)}>Archive</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ── Campaigns ────────────────────────────────────────────────────────────────

function CampaignsTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      const [c, t] = await Promise.all([apiFetch<CampaignRow[]>('/notifications/campaigns'), apiFetch<TemplateRow[]>('/notifications/templates')]);
      setRows(c);
      setTemplates(t);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load campaigns.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New campaign'}</Button>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            Campaigns fan out one notification per recipient via the worker — audience is resolved at launch.
          </span>
        </div>
      )}

      {canManage && showCreate && <CreateCampaignForm templates={templates} onError={onError} onNotice={onNotice} onCreated={() => { setShowCreate(false); void load(); }} />}

      {selected ? (
        <CampaignDetailPanel campaignId={selected} onError={onError} onNotice={onNotice} canManage={canManage} onBack={() => { setSelected(null); void load(); }} />
      ) : (
        <Card>
          <Table head={['Name', 'Template', 'Channel', 'Status', 'Audience', 'Scheduled', 'Created', '']}>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{c.name}</td>
                <td style={td}>{c.template.name}</td>
                <td style={td}><Badge value={c.template.channel} colors={CHANNEL_COLORS} /></td>
                <td style={td}><Badge value={c.status} colors={CAMPAIGN_COLORS} /></td>
                <td style={td}>{c.audienceCount != null ? c.audienceCount : '—'}</td>
                <td style={td}>{c.scheduledAt ? fmtDateTime(c.scheduledAt) : '—'}</td>
                <td style={td}>{fmtDate(c.createdAt)}</td>
                <td style={td}><Button variant="secondary" onClick={() => setSelected(c.id)}>Open</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Builds a NotificationAudienceFilter from the structured form (type + comma-separated ids). */
function buildAudienceFilter(type: string, idsText: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { type };
  if (type === 'ALL') return filter;
  const ids = idsText.split(',').map((s) => s.trim()).filter(Boolean);
  const keyByType: Record<string, string> = {
    ROLES: 'roleCodes',
    DEPARTMENTS: 'departmentIds',
    CAMPUSES: 'campusIds',
    BATCHES: 'batchIds',
    STUDENTS: 'studentIds',
    USERS: 'userIds',
  };
  filter[keyByType[type] ?? 'userIds'] = ids;
  return filter;
}

function CreateCampaignForm({ templates, onError, onNotice, onCreated }: { templates: TemplateRow[]; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', templateId: '', audienceType: 'ALL', idsText: '', scheduledAt: '' });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const audienceFilter = buildAudienceFilter(form.audienceType, form.idsText);

  const preview = async () => {
    try {
      const ids = await apiFetch<string[]>('/notifications/campaigns/preview', { method: 'POST', body: JSON.stringify(audienceFilter) });
      setPreviewCount(ids.length);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Audience preview failed.');
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: form.name, templateId: form.templateId, audienceFilter };
      if (form.description) body.description = form.description;
      if (form.scheduledAt) body.scheduledAt = form.scheduledAt;
      await apiFetch('/notifications/campaigns', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Campaign created. Launch it when ready.');
      setForm({ name: '', description: '', templateId: '', audienceType: 'ALL', idsText: '', scheduledAt: '' });
      setPreviewCount(null);
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create campaign.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New campaign</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Template</label>
          <select style={selectStyle} value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            <option value="">Select…</option>
            {templates.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>)}
          </select>
        </div>
        <Input label="Scheduled at (optional, ISO-8601)" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Audience type</label>
          <select style={selectStyle} value={form.audienceType} onChange={(e) => setForm({ ...form, audienceType: e.target.value })}>
            {AUDIENCE_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {form.audienceType === 'ROLES' ? (
          <Input label="Role codes (comma separated, e.g. STUDENT,FACULTY)" value={form.idsText} onChange={(e) => setForm({ ...form, idsText: e.target.value })} style={{ minWidth: 320 }} />
        ) : form.audienceType !== 'ALL' ? (
          <Input label="Ids (comma separated UUIDs)" value={form.idsText} onChange={(e) => setForm({ ...form, idsText: e.target.value })} style={{ minWidth: 320 }} />
        ) : null}
        <Button variant="secondary" onClick={() => void preview()}>Preview audience</Button>
        {previewCount != null && <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#15803d' }}>{previewCount} recipient(s)</span>}
      </div>

      <div style={{ marginTop: 10 }}>
        <Button disabled={busy || !form.name || !form.templateId} onClick={submit}>Create campaign</Button>
      </div>
    </Card>
  );
}

function CampaignDetailPanel({ campaignId, canManage, onError, onNotice, onBack }: { campaignId: string; canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onBack: () => void }) {
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const [c, d] = await Promise.all([
        apiFetch<CampaignRow>(`/notifications/campaigns/${campaignId}`),
        apiFetch<NotificationRow[]>(`/notifications/campaigns/${campaignId}/deliveries?take=100`),
      ]);
      setCampaign(c);
      setDeliveries(d);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load campaign.');
    }
  }, [campaignId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!campaign) return <Card><p>Loading…</p></Card>;

  const act = async (path: string, success: string) => {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({}) });
      onNotice(success);
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const canLaunch = campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED';
  const canCancel = campaign.status !== 'COMPLETED' && campaign.status !== 'CANCELED';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem' }}>{campaign.name}</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            <Badge value={campaign.status} colors={CAMPAIGN_COLORS} /> · {campaign.template.name} ({campaign.template.channel}) · audience {campaign.audienceCount != null ? campaign.audienceCount : 'not resolved yet'}
          </p>
          {campaign.description && <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>{campaign.description}</p>}
          <pre style={{ fontSize: '0.8rem', background: '#f9fafb', padding: 8, borderRadius: 6, overflowX: 'auto' }}>
            {JSON.stringify(campaign.audienceFilter, null, 2)}
          </pre>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canManage && canLaunch && <Button onClick={() => void act(`/notifications/campaigns/${campaignId}/launch`, 'Campaign launched.')}>Launch</Button>}
          {canManage && canCancel && <Button variant="secondary" onClick={() => void act(`/notifications/campaigns/${campaignId}/cancel`, 'Campaign canceled.')}>Cancel</Button>}
          <Button variant="secondary" onClick={onBack}>Back to list</Button>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Deliveries ({deliveries.length})</h3>
        <Table head={['Recipient', 'Channel', 'Subject', 'Status', 'Attempts', 'Error']}>
          {deliveries.map((n) => (
            <tr key={n.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{n.recipientUserId ?? '—'}</td>
              <td style={td}><Badge value={n.channel} colors={CHANNEL_COLORS} /></td>
              <td style={td}>{n.subject}</td>
              <td style={td}><Badge value={n.status} colors={STATUS_COLORS} /></td>
              <td style={td}>{n.attempts}</td>
              <td style={td}>{n.error ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
  );
}

// ── Event triggers ───────────────────────────────────────────────────────────

function TriggersTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<TriggerRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [form, setForm] = useState({ eventKey: '', templateId: '' });

  const load = useCallback(async () => {
    onError(null);
    try {
      const [t, tmpl] = await Promise.all([apiFetch<TriggerRow[]>('/notifications/triggers'), apiFetch<TemplateRow[]>('/notifications/templates')]);
      setRows(t);
      setTemplates(tmpl);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load event triggers.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      await apiFetch('/notifications/triggers', { method: 'POST', body: JSON.stringify({ eventKey: form.eventKey, templateId: form.templateId }) });
      onNotice('Event trigger created.');
      setForm({ eventKey: '', templateId: '' });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create trigger.');
    }
  };

  const remove = async (t: TriggerRow) => {
    try {
      await apiFetch(`/notifications/triggers/${t.id}`, { method: 'DELETE' });
      onNotice('Event trigger deleted.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete trigger.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New event trigger</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>
            Maps a free-form event key (e.g. <code>helpdesk.ticket.created</code>) to a template. When any module fires that event, the recipient gets the template rendered with the provided variables.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Event key" value={form.eventKey} onChange={(e) => setForm({ ...form, eventKey: e.target.value })} style={{ minWidth: 280 }} />
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Template</label>
              <select style={selectStyle} value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                <option value="">Select…</option>
                {templates.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>)}
              </select>
            </div>
            <Button disabled={!form.eventKey || !form.templateId} onClick={create}>Add trigger</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Event key', 'Template', 'Channel', 'Active', 'Created', '']}>
          {rows.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}><code>{t.eventKey}</code></td>
              <td style={td}>{t.template.name}</td>
              <td style={td}><Badge value={t.template.channel} colors={CHANNEL_COLORS} /></td>
              <td style={td}>{t.isActive ? 'Yes' : 'No'}</td>
              <td style={td}>{fmtDate(t.createdAt)}</td>
              <td style={td}>{canManage && <Button variant="secondary" onClick={() => void remove(t)}>Delete</Button>}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ── Provider configs ─────────────────────────────────────────────────────────

function ProvidersTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<ProviderConfigRow[]>([]);
  const [form, setForm] = useState({ channel: 'EMAIL', provider: 'smtp', name: '', config: '', credentials: '', isDefault: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows(await apiFetch<ProviderConfigRow[]>('/notifications/provider-configs'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load provider configs.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const parseJson = (raw: string): Record<string, unknown> | undefined => {
    const trimmed = raw.trim();
    return trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : undefined;
  };

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const body: Record<string, unknown> = { channel: form.channel, provider: form.provider, isDefault: form.isDefault };
      if (form.name) body.name = form.name;
      const config = parseJson(form.config);
      const credentials = parseJson(form.credentials);
      if (config !== undefined) body.config = config;
      if (credentials !== undefined) body.credentials = credentials;
      await apiFetch('/notifications/provider-configs', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Provider config created. Toggle it active to enable delivery.');
      setForm({ channel: 'EMAIL', provider: 'smtp', name: '', config: '', credentials: '', isDefault: false });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create provider config.');
    } finally {
      setBusy(false);
    }
  };

  const setState = async (row: ProviderConfigRow, patch: { isActive?: boolean; isDefault?: boolean }) => {
    try {
      await apiFetch(`/notifications/provider-configs/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      onNotice('Provider config updated.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update provider config.');
    }
  };

  const remove = async (row: ProviderConfigRow) => {
    try {
      await apiFetch(`/notifications/provider-configs/${row.id}`, { method: 'DELETE' });
      onNotice('Provider config deleted.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete provider config.');
    }
  };

  const providers = PROVIDERS_BY_CHANNEL[form.channel] ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New provider config</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>
            Credentials are encrypted at rest and never returned by the API. In development, the console provider prints delivered messages to the worker log.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Channel</label>
              <select style={selectStyle} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value, provider: PROVIDERS_BY_CHANNEL[e.target.value]?.[0] ?? '' })}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Provider</label>
              <select style={selectStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <Input label="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center', alignSelf: 'flex-end' }}>
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Default
            </label>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Config (JSON, non-secret — host, port, from, url…)</label>
              <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} rows={3} placeholder="{&quot;host&quot;: &quot;smtp.example.com&quot;, &quot;port&quot;: 587, &quot;from&quot;: &quot;noreply@example.com&quot;}" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Credentials (JSON, secret — never returned)</label>
              <textarea value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} rows={3} placeholder="{&quot;username&quot;: &quot;api&quot;, &quot;password&quot;: &quot;secret&quot;}" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Button disabled={busy} onClick={submit}>Create provider config</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Channel', 'Provider', 'Name', 'Active', 'Default', 'Updated', '']}>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}><Badge value={r.channel} colors={CHANNEL_COLORS} /></td>
              <td style={td}>{r.provider}</td>
              <td style={td}>{r.name ?? '—'}</td>
              <td style={td}>{r.isActive ? 'Yes' : 'No'}</td>
              <td style={td}>{r.isDefault ? 'Yes' : 'No'}</td>
              <td style={td}>{fmtDate(r.updatedAt)}</td>
              <td style={td}>
                {canManage && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" onClick={() => void setState(r, { isActive: !r.isActive })}>{r.isActive ? 'Deactivate' : 'Activate'}</Button>
                    {!r.isDefault && <Button variant="secondary" onClick={() => void setState(r, { isDefault: true })}>Default</Button>}
                    <Button variant="secondary" onClick={() => void remove(r)}>Delete</Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}