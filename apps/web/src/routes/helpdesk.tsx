import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  AgentReport,
  AttachmentRow,
  CategoryReport,
  CategoryRow,
  DepartmentReport,
  DepartmentRow,
  EscalationRow,
  HELPDESK_CREATE_PERMISSION,
  HELPDESK_MANAGE_PERMISSION,
  HELPDESK_UPDATE_PERMISSION,
  HELPDESK_VIEW_PERMISSION,
  HistoryRow,
  LookupsPayload,
  Paged,
  PRIORITY_COLORS,
  SatisfactionReport,
  SlaPolicyRow,
  STATUS_COLORS,
  SummaryReport,
  TicketDetail,
  TicketRow,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TrendReport,
  fmtDateTime,
  minutesLabel,
} from './helpdesk-shared';

type Tab = 'dashboard' | 'tickets' | 'categories' | 'departments' | 'sla' | 'reports';

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

export function HelpdeskPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookups, setLookups] = useState<LookupsPayload | null>(null);

  const canView = permissions.includes(HELPDESK_VIEW_PERMISSION);
  const canCreate = permissions.includes(HELPDESK_CREATE_PERMISSION);
  const canUpdate = permissions.includes(HELPDESK_UPDATE_PERMISSION);
  const canManage = permissions.includes(HELPDESK_MANAGE_PERMISSION);

  const loadLookups = useCallback(async () => {
    try {
      setLookups(await apiFetch<LookupsPayload>('/helpdesk/lookups'));
    } catch {
      setLookups(null);
    }
  }, []);

  useEffect(() => {
    if (canView) void loadLookups();
  }, [canView, loadLookups]);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view the helpdesk module.</p>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'categories', label: 'Categories' },
    { key: 'departments', label: 'Departments' },
    { key: 'sla', label: 'SLA Policies' },
    { key: 'reports', label: 'Reports' },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Helpdesk &amp; Feedback</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'dashboard' && <DashboardTab onError={setError} onOpenTicket={() => setTab('tickets')} />}
      {tab === 'tickets' && (
        <TicketsTab
          lookups={lookups}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canManage={canManage}
          onError={setError}
          onNotice={setNotice}
          onRefreshLookups={loadLookups}
        />
      )}
      {tab === 'categories' && <CategoriesTab lookups={lookups} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'departments' && <DepartmentsTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'sla' && <SlaTab lookups={lookups} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'reports' && <ReportsTab lookups={lookups} onError={setError} />}
    </div>
  );
}

function userMap(lookups: LookupsPayload | null): Map<string, string> {
  const map = new Map<string, string>();
  lookups?.users.forEach((u) => map.set(u.id, u.fullName));
  return map;
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

// ── Dashboard ───────────────────────────────────────────────────────────────

function DashboardTab({ onError, onOpenTicket }: { onError: (m: string | null) => void; onOpenTicket: () => void }) {
  const [summary, setSummary] = useState<SummaryReport | null>(null);
  const [trend, setTrend] = useState<TrendReport | null>(null);
  const [satisfaction, setSatisfaction] = useState<SatisfactionReport | null>(null);

  useEffect(() => {
    onError(null);
    Promise.all([
      apiFetch<SummaryReport>('/helpdesk/summary'),
      apiFetch<TrendReport>('/helpdesk/reports/trend'),
      apiFetch<SatisfactionReport>('/helpdesk/reports/satisfaction'),
    ])
      .then(([s, t, sat]) => {
        setSummary(s);
        setTrend(t);
        setSatisfaction(sat);
      })
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load dashboard.'));
  }, [onError]);

  if (!summary) return null;

  return (
    <>
      <StatGrid
        cards={[
          { label: 'Total tickets', value: String(summary.total) },
          { label: 'Open', value: String(summary.open), color: '#2563eb' },
          { label: 'Overdue', value: String(summary.overdue), color: summary.overdue > 0 ? '#b91c1c' : '#15803d' },
          { label: 'Unassigned', value: String(summary.unassigned), color: summary.unassigned > 0 ? '#f59e0b' : '#15803d' },
          { label: 'Resolved', value: String(summary.resolved), color: '#15803d' },
          { label: 'Avg first response', value: minutesLabel(summary.avgFirstResponseMinutes) },
          { label: 'Avg resolution', value: minutesLabel(summary.avgResolutionMinutes) },
          { label: 'SLA compliance', value: `${Math.round(summary.slaComplianceRate * 100)}%`, color: summary.slaComplianceRate >= 0.9 ? '#15803d' : '#f59e0b' },
          { label: 'Satisfaction', value: summary.satisfactionAverage != null ? summary.satisfactionAverage.toFixed(2) + ' / 5' : '—' },
        ]}
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By status</h2>
          <Table head={['Status', 'Count']}>
            {Object.entries(summary.byStatus).map(([status, count]) => (
              <tr key={status} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={status} colors={STATUS_COLORS} /></td>
                <td style={td}>{count}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By priority</h2>
          <Table head={['Priority', 'Count']}>
            {Object.entries(summary.byPriority).map(([priority, count]) => (
              <tr key={priority} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}><Badge value={priority} colors={PRIORITY_COLORS} /></td>
                <td style={td}>{count}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Satisfaction</h2>
          {satisfaction ? (
            <>
              <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                {satisfaction.totalResponses} response(s) · avg {satisfaction.average != null ? satisfaction.average.toFixed(2) : '—'}
              </p>
              <Table head={['Score', 'Count']}>
                {['5', '4', '3', '2', '1'].map((score) => (
                  <tr key={score} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={td}>{score} ★</td>
                    <td style={td}>{satisfaction.distribution[score] ?? 0}</td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}
        </Card>
      </div>

      {trend && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Created vs resolved ({fmtDate(trend.from)} → {fmtDate(trend.to)})</h2>
          <Table head={['Date', 'Created', 'Resolved']}>
            {trend.days.map((d) => (
              <tr key={d.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{d.date}</td>
                <td style={td}>{d.created}</td>
                <td style={td}>{d.resolved}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Button variant="secondary" onClick={onOpenTicket}>Go to tickets</Button>
    </>
  );
}

// ── Tickets ─────────────────────────────────────────────────────────────────

interface TicketsProps {
  lookups: LookupsPayload | null;
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
  onRefreshLookups: () => void;
}

function TicketsTab({ lookups, canCreate, canUpdate, canManage, onError, onNotice, onRefreshLookups }: TicketsProps) {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: '', priority: '', departmentId: '', unassigned: false, breached: false, search: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const qs = () => {
    const p = new URLSearchParams();
    p.set('take', '100');
    if (filters.status) p.set('status', filters.status);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.departmentId) p.set('departmentId', filters.departmentId);
    if (filters.unassigned) p.set('unassigned', 'true');
    if (filters.breached) p.set('breached', 'true');
    if (filters.search) p.set('search', filters.search);
    return p.toString();
  };

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<TicketRow>>(`/helpdesk/tickets?${qs()}`);
      setRows(res.items);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load tickets.');
    }
  }, [onError, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = userMap(lookups);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input label="Search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Status</label>
            <select style={selectStyle} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Priority</label>
            <select style={selectStyle} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
              <option value="">All</option>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Department</label>
            <select style={selectStyle} value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}>
              <option value="">All</option>
              {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={filters.unassigned} onChange={(e) => setFilters({ ...filters, unassigned: e.target.checked })} /> Unassigned
          </label>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={filters.breached} onChange={(e) => setFilters({ ...filters, breached: e.target.checked })} /> Breached
          </label>
          <Button variant="secondary" onClick={() => void load()}>Apply</Button>
          {canCreate && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New ticket'}</Button>}
          {canManage && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const res = await apiFetch<{ evaluated: number; escalated: number }>('/helpdesk/sla/sweep', { method: 'POST' });
                  onNotice(`SLA sweep evaluated ${res.evaluated} ticket(s), escalated ${res.escalated}.`);
                  onError(null);
                  void load();
                } catch (err) {
                  onError(err instanceof Error ? err.message : 'SLA sweep failed.');
                }
              }}
            >
              Run SLA sweep
            </Button>
          )}
        </div>
      </Card>

      {showCreate && (
        <CreateTicketForm
          lookups={lookups}
          onError={onError}
          onNotice={onNotice}
          onCreated={() => {
            setShowCreate(false);
            void load();
            onRefreshLookups();
          }}
        />
      )}

      {selected ? (
        <TicketDetailPanel
          ticketId={selected}
          lookups={lookups}
          canUpdate={canUpdate}
          onError={onError}
          onNotice={onNotice}
          onBack={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : (
        <Card>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>{total} ticket(s)</p>
          <Table head={['Number', 'Subject', 'Status', 'Priority', 'Category', 'Department', 'Assignee', 'Due', '']}>
            {rows.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{t.ticketNumber}</td>
                <td style={td}>{t.subject}</td>
                <td style={td}><Badge value={t.status} colors={STATUS_COLORS} /></td>
                <td style={td}><Badge value={t.priority} colors={PRIORITY_COLORS} /></td>
                <td style={td}>{t.category?.name}</td>
                <td style={td}>{t.department?.name ?? '—'}</td>
                <td style={td}>{t.assignedToUserId ? names.get(t.assignedToUserId) ?? t.assignedToUserId : '—'}</td>
                <td style={td}>{fmtDate(t.resolutionDueAt)}</td>
                <td style={td}><Button variant="secondary" onClick={() => setSelected(t.id)}>Open</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function CreateTicketForm({ lookups, onError, onNotice, onCreated }: { lookups: LookupsPayload | null; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ subject: '', description: '', categoryId: '', priority: '', departmentId: '', assignedToUserId: '', requesterName: '', requesterEmail: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const body: Record<string, unknown> = { subject: form.subject, description: form.description, categoryId: form.categoryId };
      if (form.priority) body.priority = form.priority;
      if (form.departmentId) body.departmentId = form.departmentId;
      if (form.assignedToUserId) body.assignedToUserId = form.assignedToUserId;
      if (form.requesterName) body.requesterName = form.requesterName;
      if (form.requesterEmail) body.requesterEmail = form.requesterEmail;
      await apiFetch('/helpdesk/tickets', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Ticket created.');
      setForm({ subject: '', description: '', categoryId: '', priority: '', departmentId: '', assignedToUserId: '', requesterName: '', requesterEmail: '' });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create ticket.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New ticket</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Category</label>
          <select style={selectStyle} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Select…</option>
            {lookups?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Priority</label>
          <select style={selectStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="">Category default</option>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Department</label>
          <select style={selectStyle} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">Category default</option>
            {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Assign to</label>
          <select style={selectStyle} value={form.assignedToUserId} onChange={(e) => setForm({ ...form, assignedToUserId: e.target.value })}>
            <option value="">Unassigned</option>
            {lookups?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </div>
        <Input label="Requester name (optional)" value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
        <Input label="Requester email (optional)" value={form.requesterEmail} onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: '0.85rem', color: '#374151' }}>Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <Button disabled={busy || !form.subject || !form.description || !form.categoryId} onClick={submit}>Create ticket</Button>
      </div>
    </Card>
  );
}

function TicketDetailPanel({ ticketId, lookups, canUpdate, onError, onNotice, onBack }: { ticketId: string; lookups: LookupsPayload | null; canUpdate: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onBack: () => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [comment, setComment] = useState({ body: '', visibility: 'PUBLIC' });
  const [status, setStatus] = useState('');
  const [resolveSummary, setResolveSummary] = useState('');
  const [assign, setAssign] = useState({ assignedToUserId: '', departmentId: '' });
  const [escalate, setEscalate] = useState({ toUserId: '', toRoleCode: '', note: '' });
  const [feedback, setFeedback] = useState({ score: 5, comment: '' });

  const load = useCallback(async () => {
    onError(null);
    try {
      const t = await apiFetch<TicketDetail>(`/helpdesk/tickets/${ticketId}`);
      setTicket(t);
      setStatus(t.status);
      setAssign({ assignedToUserId: t.assignedToUserId ?? '', departmentId: t.department?.id ?? '' });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load ticket.');
    }
  }, [ticketId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = userMap(lookups);

  const act = async (path: string, body: unknown, success: string) => {
    try {
      await apiFetch(`/helpdesk/tickets/${ticketId}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      onNotice(success);
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  if (!ticket) return <Card><p>Loading…</p></Card>;

  const uploadAndAttach = async (file: File) => {
    try {
      const up = await apiFetch<{ document: { id: string }; uploadUrl: string }>('/documents/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', category: 'helpdesk' }),
      });
      await fetch(up.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      await apiFetch(`/documents/${up.document.id}/confirm-upload`, { method: 'POST', body: JSON.stringify({ sizeBytes: file.size }) });
      await apiFetch(`/helpdesk/tickets/${ticketId}/attachments`, { method: 'POST', body: JSON.stringify({ documentId: up.document.id }) });
      onNotice('Attachment uploaded.');
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem' }}>{ticket.ticketNumber} — {ticket.subject}</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            <Badge value={ticket.status} colors={STATUS_COLORS} /> · <Badge value={ticket.priority} colors={PRIORITY_COLORS} /> · {ticket.category?.name} · {ticket.department?.name ?? 'No department'} · created {fmtDateTime(ticket.createdAt)}
          </p>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            Response due {fmtDateTime(ticket.responseDueAt)} · Resolution due {fmtDateTime(ticket.resolutionDueAt)} · Reopened {ticket.reopenedCount} · Escalation level {ticket.escalationLevel}
          </p>
        </div>
        <Button variant="secondary" onClick={onBack}>Back to list</Button>
      </div>

      <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{ticket.description}</p>
      {ticket.resolutionSummary && <p style={{ marginTop: 8, color: '#15803d' }}><strong>Resolution:</strong> {ticket.resolutionSummary}</p>}

      {canUpdate && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Change status</label>
              <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Button onClick={() => act('/status', { status }, `Status changed to ${status}.`)}>Apply status</Button>
            <Button variant="secondary" onClick={() => act('/close', {}, 'Ticket closed.')}>Close</Button>
            <Button variant="secondary" onClick={() => act('/reopen', {}, 'Ticket reopened.')}>Reopen</Button>
            <Button variant="secondary" onClick={() => act('/cancel', {}, 'Ticket cancelled.')}>Cancel</Button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Resolution summary" value={resolveSummary} onChange={(e) => setResolveSummary(e.target.value)} style={{ minWidth: 280 }} />
            <Button onClick={() => act('/resolve', { resolutionSummary: resolveSummary }, 'Ticket resolved.')}>Resolve</Button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Assign to</label>
              <select style={selectStyle} value={assign.assignedToUserId} onChange={(e) => setAssign({ ...assign, assignedToUserId: e.target.value })}>
                <option value="">Unassigned</option>
                {lookups?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Department</label>
              <select style={selectStyle} value={assign.departmentId} onChange={(e) => setAssign({ ...assign, departmentId: e.target.value })}>
                <option value="">None</option>
                {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <Button onClick={() => act('/assign', assign, 'Ticket assigned.')}>Assign</Button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Escalate to role (code)" value={escalate.toRoleCode} onChange={(e) => setEscalate({ ...escalate, toRoleCode: e.target.value })} />
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>or user</label>
              <select style={selectStyle} value={escalate.toUserId} onChange={(e) => setEscalate({ ...escalate, toUserId: e.target.value })}>
                <option value="">—</option>
                {lookups?.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
            <Input label="Note" value={escalate.note} onChange={(e) => setEscalate({ ...escalate, note: e.target.value })} />
            <Button variant="secondary" onClick={() => act('/escalate', { toUserId: escalate.toUserId || undefined, toRoleCode: escalate.toRoleCode || undefined, note: escalate.note || undefined }, 'Ticket escalated.')}>Escalate</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Conversation</h3>
        {ticket.comments.map((c) => (
          <div key={c.id} style={{ borderLeft: c.visibility === 'INTERNAL' ? '3px solid #f59e0b' : '3px solid #3b82f6', padding: '6px 10px', marginBottom: 6, background: '#f9fafb' }}>
            <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>
              {c.authorUserId ? names.get(c.authorUserId) ?? c.authorUserId : 'System'} · {fmtDateTime(c.createdAt)} {c.visibility === 'INTERNAL' ? '· internal note' : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        ))}
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea value={comment.body} onChange={(e) => setComment({ ...comment, body: e.target.value })} rows={3} placeholder="Write a reply or internal note…" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={selectStyle} value={comment.visibility} onChange={(e) => setComment({ ...comment, visibility: e.target.value })}>
              <option value="PUBLIC">Public reply</option>
              <option value="INTERNAL">Internal note</option>
            </select>
            <Button disabled={!comment.body} onClick={() => { void act('/comments', comment, 'Comment added.'); setComment({ body: '', visibility: comment.visibility }); }}>Add comment</Button>
            <label style={{ fontSize: '0.85rem', color: '#1d4ed8', cursor: 'pointer' }}>
              Attach file
              <input type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAndAttach(f); }} />
            </label>
          </div>
        </div>
      </div>

      {ticket.attachments.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Attachments</h3>
          {ticket.attachments.map((a: AttachmentRow) => (
            <div key={a.id} style={{ fontSize: '0.85rem' }}>{a.filename} ({Math.round((a.sizeBytes ?? 0) / 1024)} KB)</div>
          ))}
        </div>
      )}

      {['RESOLVED', 'CLOSED'].includes(ticket.status) && !ticket.satisfactionSubmittedAt && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Submit feedback</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Score</label>
              <select style={selectStyle} value={feedback.score} onChange={(e) => setFeedback({ ...feedback, score: Number(e.target.value) })}>
                {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s} ★</option>)}
              </select>
            </div>
            <Input label="Comment" value={feedback.comment} onChange={(e) => setFeedback({ ...feedback, comment: e.target.value })} />
            <Button onClick={() => act('/feedback', feedback, 'Feedback submitted.')}>Submit feedback</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>History</h3>
          <Table head={['Event', 'From → To', 'By', 'When']}>
            {ticket.history.map((h: HistoryRow) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{h.event}</td>
                <td style={td}>{h.fromValue ?? '—'} → {h.toValue ?? '—'}</td>
                <td style={td}>{h.actorUserId ? names.get(h.actorUserId) ?? h.actorUserId : h.actorType}</td>
                <td style={td}>{fmtDateTime(h.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Escalations</h3>
          <Table head={['Reason', 'Level', 'To', 'When']}>
            {ticket.escalations.map((e: EscalationRow) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={td}>{e.reason}</td>
                <td style={td}>{e.level}</td>
                <td style={td}>{e.toUserId ? names.get(e.toUserId) ?? e.toUserId : e.toRoleCode ?? '—'}</td>
                <td style={td}>{fmtDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </Card>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function CategoriesTab({ lookups, canManage, onError, onNotice }: { lookups: LookupsPayload | null; canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [form, setForm] = useState({ code: '', name: '', defaultPriority: 'MEDIUM', defaultDepartmentId: '', slaPolicyId: '', requiresApproval: false });

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<CategoryRow>>('/helpdesk/categories?take=200');
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load categories.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      const body: Record<string, unknown> = { code: form.code, name: form.name, defaultPriority: form.defaultPriority, requiresApproval: form.requiresApproval };
      if (form.defaultDepartmentId) body.defaultDepartmentId = form.defaultDepartmentId;
      if (form.slaPolicyId) body.slaPolicyId = form.slaPolicyId;
      await apiFetch('/helpdesk/categories', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Category created.');
      setForm({ code: '', name: '', defaultPriority: 'MEDIUM', defaultDepartmentId: '', slaPolicyId: '', requiresApproval: false });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create category.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New category</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Default priority</label>
              <select style={selectStyle} value={form.defaultPriority} onChange={(e) => setForm({ ...form, defaultPriority: e.target.value })}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Department</label>
              <select style={selectStyle} value={form.defaultDepartmentId} onChange={(e) => setForm({ ...form, defaultDepartmentId: e.target.value })}>
                <option value="">None</option>
                {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>SLA policy</label>
              <select style={selectStyle} value={form.slaPolicyId} onChange={(e) => setForm({ ...form, slaPolicyId: e.target.value })}>
                <option value="">None</option>
                {lookups?.slaPolicies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} /> Requires approval
            </label>
            <Button disabled={!form.code || !form.name} onClick={create}>Add</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Code', 'Name', 'Priority', 'Department', 'SLA', 'Approval', 'Active', 'Tickets']}>
          {rows.map((c) => (
            <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{c.code}</td>
              <td style={td}>{c.name}</td>
              <td style={td}><Badge value={c.defaultPriority} colors={PRIORITY_COLORS} /></td>
              <td style={td}>{c.defaultDepartment?.name ?? '—'}</td>
              <td style={td}>{c.slaPolicy?.name ?? '—'}</td>
              <td style={td}>{c.requiresApproval ? 'Yes' : 'No'}</td>
              <td style={td}>{c.isActive ? 'Yes' : 'No'}</td>
              <td style={td}>{c._count?.tickets ?? 0}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ── Departments ─────────────────────────────────────────────────────────────

function DepartmentsTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [form, setForm] = useState({ code: '', name: '', email: '' });

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows((await apiFetch<Paged<DepartmentRow>>('/helpdesk/departments?take=200')).items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load departments.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      const body: Record<string, unknown> = { code: form.code, name: form.name };
      if (form.email) body.email = form.email;
      await apiFetch('/helpdesk/departments', { method: 'POST', body: JSON.stringify(body) });
      onNotice('Department created.');
      setForm({ code: '', name: '', email: '' });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create department.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New department</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Button disabled={!form.code || !form.name} onClick={create}>Add</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Code', 'Name', 'Email', 'Active', 'Categories', 'Tickets']}>
          {rows.map((d) => (
            <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{d.code}</td>
              <td style={td}>{d.name}</td>
              <td style={td}>{d.email ?? '—'}</td>
              <td style={td}>{d.isActive ? 'Yes' : 'No'}</td>
              <td style={td}>{d._count?.categories ?? 0}</td>
              <td style={td}>{d._count?.tickets ?? 0}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ── SLA policies ────────────────────────────────────────────────────────────

function SlaTab({ lookups, canManage, onError, onNotice }: { lookups: LookupsPayload | null; canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [rows, setRows] = useState<SlaPolicyRow[]>([]);
  const [form, setForm] = useState({ code: '', name: '', priority: '', departmentId: '', responseMinutes: '240', resolutionMinutes: '1440', escalateToRoleCode: '', escalateAfterMinutes: '', isDefault: false });

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows((await apiFetch<Paged<SlaPolicyRow>>('/helpdesk/sla-policies?take=200')).items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load SLA policies.');
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    try {
      const body: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        responseMinutes: Number(form.responseMinutes),
        resolutionMinutes: Number(form.resolutionMinutes),
        isDefault: form.isDefault,
      };
      if (form.priority) body.priority = form.priority;
      if (form.departmentId) body.departmentId = form.departmentId;
      if (form.escalateToRoleCode) body.escalateToRoleCode = form.escalateToRoleCode;
      if (form.escalateAfterMinutes) body.escalateAfterMinutes = Number(form.escalateAfterMinutes);
      await apiFetch('/helpdesk/sla-policies', { method: 'POST', body: JSON.stringify(body) });
      onNotice('SLA policy created.');
      setForm({ code: '', name: '', priority: '', departmentId: '', responseMinutes: '240', resolutionMinutes: '1440', escalateToRoleCode: '', escalateAfterMinutes: '', isDefault: false });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create SLA policy.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>New SLA policy</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Priority</label>
              <select style={selectStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="">Any</option>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: '#374151' }}>Department</label>
              <select style={selectStyle} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">Any</option>
                {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <Input label="Response (min)" value={form.responseMinutes} onChange={(e) => setForm({ ...form, responseMinutes: e.target.value })} />
            <Input label="Resolution (min)" value={form.resolutionMinutes} onChange={(e) => setForm({ ...form, resolutionMinutes: e.target.value })} />
            <Input label="Escalate to role" value={form.escalateToRoleCode} onChange={(e) => setForm({ ...form, escalateToRoleCode: e.target.value })} />
            <Input label="Escalate after (min)" value={form.escalateAfterMinutes} onChange={(e) => setForm({ ...form, escalateAfterMinutes: e.target.value })} />
            <label style={{ fontSize: '0.85rem', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Default
            </label>
            <Button disabled={!form.code || !form.name} onClick={create}>Add</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table head={['Code', 'Name', 'Priority', 'Department', 'Response', 'Resolution', 'Escalate role', 'Default', 'Active']}>
          {rows.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{p.code}</td>
              <td style={td}>{p.name}</td>
              <td style={td}>{p.priority ?? 'Any'}</td>
              <td style={td}>{p.department?.name ?? 'Any'}</td>
              <td style={td}>{minutesLabel(p.responseMinutes)}</td>
              <td style={td}>{minutesLabel(p.resolutionMinutes)}</td>
              <td style={td}>{p.escalateToRoleCode ?? '—'}</td>
              <td style={td}>{p.isDefault ? 'Yes' : 'No'}</td>
              <td style={td}>{p.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportsTab({ lookups, onError }: { lookups: LookupsPayload | null; onError: (m: string | null) => void }) {
  const [departments, setDepartments] = useState<DepartmentReport[]>([]);
  const [categories, setCategories] = useState<CategoryReport[]>([]);
  const [agents, setAgents] = useState<AgentReport[]>([]);

  useEffect(() => {
    onError(null);
    Promise.all([
      apiFetch<DepartmentReport[]>('/helpdesk/reports/departments'),
      apiFetch<CategoryReport[]>('/helpdesk/reports/categories'),
      apiFetch<AgentReport[]>('/helpdesk/reports/agents'),
    ])
      .then(([d, c, a]) => {
        setDepartments(d);
        setCategories(c);
        setAgents(a);
      })
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load reports.'));
  }, [onError]);

  const names = userMap(lookups);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By department</h2>
        <Table head={['Department', 'Total', 'Open', 'Resolved', 'Satisfaction']}>
          {departments.map((d) => (
            <tr key={d.departmentId ?? 'unassigned'} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{d.name}</td>
              <td style={td}>{d.total}</td>
              <td style={td}>{d.open}</td>
              <td style={td}>{d.resolved}</td>
              <td style={td}>{d.satisfactionAverage != null ? d.satisfactionAverage.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>By category</h2>
        <Table head={['Category', 'Total', 'Open', 'Resolved']}>
          {categories.map((c) => (
            <tr key={c.categoryId} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{c.name}</td>
              <td style={td}>{c.total}</td>
              <td style={td}>{c.open}</td>
              <td style={td}>{c.resolved}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Agent performance</h2>
        <Table head={['Agent', 'Total', 'Open', 'Resolved', 'Satisfaction']}>
          {agents.map((a) => (
            <tr key={a.assignedToUserId ?? 'unassigned'} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={td}>{a.assignedToUserId ? names.get(a.assignedToUserId) ?? a.name : 'Unassigned'}</td>
              <td style={td}>{a.total}</td>
              <td style={td}>{a.open}</td>
              <td style={td}>{a.resolved}</td>
              <td style={td}>{a.satisfactionAverage != null ? a.satisfactionAverage.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
