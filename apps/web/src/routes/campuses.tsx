import React, { useCallback, useEffect, useState } from 'react';
import type {
  CampusConfigurationDto,
  CampusComparisonDto,
  CampusOverviewDto,
  CampusOverviewRowDto,
  GlobalCampusPoliciesResponseDto,
} from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';

const CAMPUS_ANALYTICS_VIEW = 'campus.analytics.view';
const CAMPUS_SETTINGS_VIEW = 'campus.settings.view';
const CAMPUS_SETTINGS_MANAGE = 'campus.settings.manage';
const CAMPUS_POLICIES_MANAGE = 'campus.policies.manage';

type TabId = 'overview' | 'compare' | 'settings' | 'policies';

function formatCents(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN')}`;
}

/**
 * Multi-campus operations page (university level): campus overview + comparison (campus.analytics.view),
 * per-campus configuration (campus.settings.view/manage) and the institution-wide campus policy
 * document (campus.policies.manage — additionally requires GLOBAL scope, enforced by the backend).
 *
 * The server enforces every permission and scope; the checks below only pick which tabs render.
 */
export function CampusesPage() {
  const { permissions } = useAuth();

  const canAnalytics = permissions.includes(CAMPUS_ANALYTICS_VIEW);
  const canViewSettings = permissions.includes(CAMPUS_SETTINGS_VIEW);
  const canManageSettings = permissions.includes(CAMPUS_SETTINGS_MANAGE);
  const canPolicies = permissions.includes(CAMPUS_POLICIES_MANAGE);

  const tabs: Array<{ id: TabId; label: string; visible: boolean }> = [
    { id: 'overview', label: 'Overview', visible: canAnalytics },
    { id: 'compare', label: 'Compare', visible: canAnalytics },
    { id: 'settings', label: 'Campus settings', visible: canViewSettings },
    { id: 'policies', label: 'Global policies', visible: canPolicies },
  ];

  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  useEffect(() => {
    // `tabs` derives purely from permissions; the initial tab is chosen once on mount.
    const first = tabs.find((t) => t.visible);
    setActiveTab((current) => current ?? first?.id ?? null);
  }, []);
  const effectiveTab = activeTab && tabs.find((t) => t.id === activeTab)?.visible ? activeTab : null;

  if (tabs.every((t) => !t.visible)) {
    return (
      <div style={{ maxWidth: 820, margin: '2rem auto' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Campuses</h1>
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have permission to view campus operations.</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Campuses</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: effectiveTab === t.id ? '#1d4ed8' : '#fff',
                color: effectiveTab === t.id ? '#fff' : '#111827',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
      </div>
      {effectiveTab === 'overview' && <OverviewTab />}
      {effectiveTab === 'compare' && <CompareTab />}
      {effectiveTab === 'settings' && <SettingsTab canManage={canManageSettings} />}
      {effectiveTab === 'policies' && <PoliciesTab />}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState<CampusOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<CampusOverviewDto>('/campuses/overview'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campus overview.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!data) return <p>Loading…</p>;
  if (data.campuses.length === 0) {
    return (
      <Card>
        <p style={{ color: '#9ca3af' }}>No campuses are visible to you.</p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.campuses.map((campus) => (
        <Card key={campus.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>
              {campus.name} <span style={{ color: '#6b7280', fontWeight: 400 }}>({campus.code})</span>
            </h2>
            <span style={{ fontSize: '0.8rem', color: campus.isActive ? '#15803d' : '#b91c1c' }}>
              {campus.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '4px 0 10px' }}>
            {[campus.city, campus.state, campus.country].filter(Boolean).join(', ') || '—'} · config v
            {campus.configVersion}
            {campus.timezone ? ` · ${campus.timezone}` : ''}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: '0.9rem' }}>
            <Metric label="Students" value={campus.counts.students.toLocaleString('en-IN')} />
            <Metric label="Departments" value={campus.counts.departments.toLocaleString('en-IN')} />
            <Metric label="Programs" value={campus.counts.programs.toLocaleString('en-IN')} />
            <Metric label="Employees" value={campus.counts.employees.toLocaleString('en-IN')} />
            <Metric label="Fee collected" value={formatCents(campus.counts.feeCollectedCents)} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CompareTab() {
  const [directory, setDirectory] = useState<CampusOverviewRowDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CampusComparisonDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDirectory = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<CampusOverviewDto>('/campuses/overview');
      setDirectory(data.campuses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campus directory.');
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
  };

  const runCompare = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const id of selected) params.append('campusIds', id);
      setResult(await apiFetch<CampusComparisonDto>(`/campuses/compare?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (directory.length === 0) {
    return <Card><p style={{ color: '#9ca3af' }}>No campuses available to compare.</p></Card>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Select campuses</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {directory.map((campus) => (
            <label key={campus.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={selected.has(campus.id)}
                onChange={() => toggle(campus.id)}
              />
              {campus.name} <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>({campus.code})</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button onClick={() => void runCompare()} disabled={busy || selected.size === 0}>
            Compare selected campus{selected.size === 1 ? '' : 'es'}
          </Button>
          {busy && <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Loading…</span>}
        </div>
      </Card>

      {result && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Comparison</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb' }}>Metric</th>
                {result.campuses.map((c) => (
                  <th key={c.id} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.metrics.map((row) => (
                <tr key={row.metric}>
                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6' }}>{row.label}</td>
                  {row.values.map((v) => (
                    <td key={v.campusId} style={{ textAlign: 'right', padding: '0.5rem 0.75rem', borderBottom: '1px solid #f3f4f6' }}>
                      {row.metric === 'feeCollectedCents' ? formatCents(v.value ?? 0) : (v.value ?? 0).toLocaleString('en-IN')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function SettingsTab({ canManage }: { canManage: boolean }) {
  const [directory, setDirectory] = useState<CampusOverviewRowDto[]>([]);
  const [campusId, setCampusId] = useState<string | null>(null);
  const [doc, setDoc] = useState<CampusConfigurationDto | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiFetch<CampusOverviewDto>('/campuses/overview');
      setDirectory(data.campuses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the campus directory.');
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const loadConfig = useCallback(async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetch<CampusConfigurationDto>(`/campuses/${id}/config`);
      setDoc(data);
      setDraft({ ...data.config });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the campus configuration.');
    }
  }, []);

  const setSection = (section: string, patch: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, [section]: { ...((prev[section] as Record<string, unknown>) ?? {}), ...patch } }));
  };

  const textField = (section: string, key: string, current: string | null | undefined) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {sectionLabel(key)}
      <input
        value={current ?? ''}
        onChange={(e) => setSection(section, { [key]: e.target.value })}
        style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );

  const numberField = (section: string, key: string, current: number | null | undefined, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {sectionLabel(key)}
      <input
        type="number"
        value={current ?? ''}
        onChange={(e) => setSection(section, { [key]: Number(e.target.value) })}
        {...props}
        style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );

  const saveSection = async (section: string) => {
    if (!campusId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<CampusConfigurationDto>(`/campuses/${campusId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ [section]: draft[section] }),
      });
      setDoc(res);
      setDraft((prev) => ({ ...prev, ...res.config }));
      setNotice(`${sectionLabel(section)} saved (v${res.version}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveTimezone = async () => {
    if (!campusId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<CampusConfigurationDto>(`/campuses/${campusId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ timezone: draft.timezone ?? null }),
      });
      setDoc(res);
      setDraft((prev) => ({ ...prev, timezone: res.config.timezone }));
      setNotice(`Timezone saved (v${res.version}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const branding = (doc?.config.branding ?? {}) as Record<string, unknown>;
  const academic = (doc?.config.academicCalendar ?? {}) as Record<string, unknown>;
  const attendance = (doc?.config.attendance ?? {}) as Record<string, unknown>;
  const fees = (doc?.config.fees ?? {}) as Record<string, unknown>;
  const numbering = (doc?.config.numbering ?? {}) as Record<string, unknown>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      <Card>
        <label style={{ display: 'block', marginBottom: 6 }}>Campus</label>
        <select
          value={campusId ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            setCampusId(id);
            if (id) void loadConfig(id);
          }}
          style={{ padding: '0.35rem 0.5rem', minWidth: 240 }}
        >
          <option value="">Select a campus…</option>
          {directory.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </Card>

      {campusId && !doc && <p>Loading configuration…</p>}

      {campusId && doc && (
        <>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>Document version {doc.version}</p>
          {!canManage && <p style={{ color: '#9ca3af' }}>View-only — you need campus.settings.manage to edit.</p>}

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Timezone</h2>
            <input
              value={(draft.timezone as string) ?? ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, timezone: e.target.value }))}
              placeholder="e.g. Asia/Kolkata (empty = global default)"
              style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
            />
            {canManage && <div style={{ marginTop: 8 }}><Button onClick={() => void saveTimezone()} disabled={busy}>Save timezone</Button></div>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding</h2>
            {textField('branding', 'collegeName', branding.collegeName as string)}
            {textField('branding', 'tagline', branding.tagline as string)}
            {textField('branding', 'primaryColor', branding.primaryColor as string)}
            {canManage && <Button onClick={() => void saveSection('branding')} disabled={busy}>Save branding</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Academic calendar</h2>
            {textField('academicCalendar', 'academicYear', academic.academicYear as string)}
            {textField('academicCalendar', 'startDate', academic.startDate as string)}
            {textField('academicCalendar', 'endDate', academic.endDate as string)}
            {canManage && <Button onClick={() => void saveSection('academicCalendar')} disabled={busy}>Save academic calendar</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Attendance</h2>
            {numberField('attendance', 'thresholdPercent', attendance.thresholdPercent as number, { min: 0, max: 100 })}
            {numberField('attendance', 'gracePeriodMinutes', attendance.gracePeriodMinutes as number, { min: 0 })}
            {canManage && <Button onClick={() => void saveSection('attendance')} disabled={busy}>Save attendance</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Fees</h2>
            {textField('fees', 'dueDate', fees.dueDate as string)}
            {numberField('fees', 'lateFeePercent', fees.lateFeePercent as number, { min: 0, max: 100 })}
            {textField('fees', 'concessionRules', fees.concessionRules as string)}
            {canManage && <Button onClick={() => void saveSection('fees')} disabled={busy}>Save fees</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Numbering</h2>
            {textField('numbering', 'studentPrefix', numbering.studentPrefix as string)}
            {textField('numbering', 'admissionPrefix', numbering.admissionPrefix as string)}
            {textField('numbering', 'feeReceiptPrefix', numbering.feeReceiptPrefix as string)}
            {canManage && <Button onClick={() => void saveSection('numbering')} disabled={busy}>Save numbering</Button>}
          </Card>
        </>
      )}
    </div>
  );
}

function sectionLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');
}

function PoliciesTab() {
  const [doc, setDoc] = useState<GlobalCampusPoliciesResponseDto | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<GlobalCampusPoliciesResponseDto>('/campuses/policies');
      setDoc(data);
      setDraft({ ...data.policies });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campus policies.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<GlobalCampusPoliciesResponseDto>('/campuses/policies', {
        method: 'PATCH',
        body: JSON.stringify(draft),
      });
      setDoc(res);
      setDraft({ ...res.policies });
      setNotice(`Policies saved (v${res.version}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!doc) return <p>Loading…</p>;

  const boolRow = (key: string, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <input
        type="checkbox"
        checked={Boolean(draft[key])}
        onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
      />
      {label}
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Institution-wide campus policy</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>Document version {doc.version}</p>
        {boolRow('campusSettingsEnabled', 'Allow campus settings edits (campus.settings.manage)')}
        {boolRow('campusAnalyticsEnabled', 'Allow campus analytics (overview & compare)')}
        {boolRow('allowCampusAdminRole', 'Allow assigning the CAMPUS_ADMIN role to users')}
        <label style={{ display: 'block', marginBottom: 10 }}>
          Default timezone for new campuses
          <input
            value={(draft.defaultTimezone as string) ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, defaultTimezone: e.target.value || null }))}
            placeholder="e.g. Asia/Kolkata"
            style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        <Button onClick={() => void save()} disabled={busy}>Save policies</Button>
      </Card>
    </div>
  );
}