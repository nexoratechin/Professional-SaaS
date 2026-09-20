import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { type AdmissionProgramRow, type AdmissionSessionRow } from './admissions';

export interface AnalyticsDto {
  sessionId: string | null;
  days: number;
  total: number;
  funnel: Array<{ stage: string; count: number; conversionRate: string }>;
  timeSeries: Array<{ date: string; applications: number }>;
  seats: { total: number; filled: number };
  perProgram: Array<{
    programId: string;
    programName: string;
    seats: number;
    filledSeats: number;
    applications: number;
    enrolled: number;
    conversionRate: string;
  }>;
}

export interface DuplicatesDto {
  sessionId: string | null;
  groups: Array<{ matchType: 'EMAIL' | 'PHONE' | 'NAME_AND_DOB'; members: DuplicateMember[] }>;
  flagged: DuplicateMember[];
}

interface DuplicateMember {
  id: string;
  applicationNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  category?: string | null;
  admissionProgram?: { program?: { id?: string; code?: string | null; name?: string | null } };
}

interface FormFieldRow {
  code: string;
  label: string;
  fieldType: string;
  placeholder: string | null;
  required: boolean;
  options: string[] | null;
  helpText: string | null;
  sequenceOrder: number;
}

interface EligibilityRuleRow {
  id: string;
  name: string;
  description: string | null;
  ruleType: string;
  config: Record<string, unknown> | null;
  appliesToCategory: string | null;
  sequenceOrder: number;
  isActive: boolean;
}

interface MessageRow {
  id: string;
  subject: string;
  body: string;
  channel: string;
  sentBy: string | null;
  sentAt: string;
}

const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'EMAIL', 'PHONE', 'SELECT', 'RADIO', 'CHECKBOX'] as const;
const RULE_TYPES = ['MIN_PERCENTAGE', 'MIN_GPA', 'MIN_MARKS', 'MIN_AGE', 'MAX_AGE', 'CATEGORY_ALLOWED', 'CUSTOM'] as const;
const MESSAGE_CHANNELS = ['EMAIL', 'SMS', 'IN_APP'] as const;
const RULE_CONFIG_PLACEHOLDER: Record<string, string> = {
  MIN_PERCENTAGE: '{"minPercentage": 60}',
  MIN_GPA: '{"minGpa": 6.5}',
  MIN_MARKS: '{"minMarks": 75, "marksOutOf": 100}',
  MIN_AGE: '{"minAgeYears": 16}',
  MAX_AGE: '{"maxAgeYears": 25}',
  CATEGORY_ALLOWED: '{"allowedCategories": ["General","SC","ST","OBC"]}',
  CUSTOM: '{"notes": "manual check"}',
};

export function InsightsTab({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [sessions, setSessions] = useState<AdmissionSessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [activeSection, setActiveSection] = useState<string>('analytics');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await apiFetch<AdmissionSessionRow[]>('/admissions/sessions');
        if (!cancelled) {
          setSessions(s);
          setSessionId((cur) => cur || s[0]?.id || '');
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load sessions.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const section = (key: string, label: string) => (
    <Button variant={activeSection === key ? 'primary' : 'secondary'} onClick={() => setActiveSection(key)}>
      {label}
    </Button>
  );

  return (
    <>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {section('analytics', 'Analytics')}
          {section('duplicates', 'Duplicates')}
          {section('form', 'Form builder')}
          {section('rules', 'Eligibility rules')}
          {section('bulk', 'Bulk tools')}
          {section('messages', 'Communication')}
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: '0.85rem', color: '#374151' }}>Session</label>
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">All sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
            ))}
          </select>
        </div>
      </Card>

      {activeSection === 'analytics' && <AnalyticsSection sessionId={sessionId} onError={onError} />}
      {activeSection === 'duplicates' && <DuplicatesSection sessionId={sessionId} onError={onError} />}
      {activeSection === 'form' && <FormBuilderSection sessionId={sessionId} onError={onError} onNotice={onNotice} />}
      {activeSection === 'rules' && <EligibilityRulesSection sessionId={sessionId} onError={onError} onNotice={onNotice} />}
      {activeSection === 'bulk' && <BulkToolsSection onError={onError} onNotice={onNotice} />}
      {activeSection === 'messages' && <CommunicationSection onError={onError} onNotice={onNotice} />}
    </>
  );
}

function AnalyticsSection({ sessionId, onError }: { sessionId: string; onError: (msg: string | null) => void }) {
  const [data, setData] = useState<AnalyticsDto | null>(null);
  const [days, setDays] = useState('30');

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      q.set('days', days || '30');
      if (sessionId) q.set('sessionId', sessionId);
      setData(await apiFetch<AnalyticsDto>(`/admissions/analytics?${q.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load analytics.');
    }
  }, [days, sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxFunnel = Math.max(...(data?.funnel.map((f) => f.count) ?? [0]), 1);
  const maxTime = Math.max(...(data?.timeSeries.map((t) => t.applications) ?? [0]), 1);

  return (
    <>
      {data && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>Funnel (last {data.days} days)</h2>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>
              Days
              <input type="number" value={days} onChange={(e) => setDays(e.target.value)} style={{ marginLeft: 8, padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db', width: 80 }} />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.funnel.map((f) => (
              <div key={f.stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 170, fontSize: '0.8rem', color: '#374151' }}>{f.stage}</span>
                <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 12 }}>
                  <div style={{ width: `${Math.max(2, (f.count / maxFunnel) * 100)}%`, height: 12, borderRadius: 4, background: '#2563eb' }} />
                </div>
                <span style={{ width: 40, textAlign: 'right', fontSize: '0.8rem' }}>{f.count}</span>
                <span style={{ width: 60, textAlign: 'right', fontSize: '0.8rem', color: '#6b7280' }}>{f.conversionRate}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Applications per day</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, overflowX: 'auto' }}>
            {data.timeSeries.map((t) => (
              <div
                key={t.date}
                style={{ flex: '0 0 14px', height: `${Math.max(2, (t.applications / maxTime) * 100)}%`, background: '#10b981', borderRadius: 2, minHeight: 2 }}
                title={`${t.date}: ${t.applications}`}
              />
            ))}
          </div>
        </Card>
      )}

      {data && data.perProgram.length > 0 && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Program yield</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Seats</th>
                <th style={{ padding: 8 }}>Applications</th>
                <th style={{ padding: 8 }}>Enrolled</th>
                <th style={{ padding: 8 }}>Yield</th>
              </tr>
            </thead>
            <tbody>
              {data.perProgram.map((p) => (
                <tr key={p.programId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{p.programName}</td>
                  <td style={{ padding: 8 }}>{p.filledSeats}/{p.seats}</td>
                  <td style={{ padding: 8 }}>{p.applications}</td>
                  <td style={{ padding: 8 }}>{p.enrolled}</td>
                  <td style={{ padding: 8 }}>{p.conversionRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {data && data.perProgram.length === 0 && (
        <Card><p style={{ color: '#9ca3af' }}>No application data for the selected window.</p></Card>
      )}
    </>
  );
}

function DuplicatesSection({
  sessionId,
  onError,
}: {
  sessionId: string;
  onError: (msg: string | null) => void;
}) {
  const [data, setData] = useState<DuplicatesDto | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (sessionId) q.set('sessionId', sessionId);
      const qs = q.toString();
      setData(await apiFetch<DuplicatesDto>(`/admissions/duplicates${qs ? `?${qs}` : ''}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to scan duplicates.');
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberTable = (members: DuplicateMember[]) => (
    <>
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
          <span style={{ color: '#374151', fontWeight: 600 }}>{m.applicationNumber}</span>
          <span>{m.fullName}</span>
          <span style={{ color: '#6b7280' }}>{m.email ?? 'no email'}</span>
          <span style={{ color: '#6b7280' }}>{m.phone ?? 'no phone'}</span>
          <span style={{ color: '#6b7280' }}>{m.admissionProgram?.program?.name ?? ''}</span>
          <span>{m.status}</span>
        </div>
      ))}
    </>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>Likely duplicates</h2>
        <Button variant="secondary" onClick={() => void load()}>Rescan</Button>
      </div>
      {!data && <p style={{ color: '#9ca3af' }}>Scanning applicants...</p>}
      {data && data.groups.length === 0 && data.flagged.length === 0 && (
        <p style={{ color: '#9ca3af' }}>No duplicates detected.</p>
      )}
      {data && data.groups.map((g, i) => (
        <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 6 }}>Match: {g.matchType}</h3>
          {memberTable(g.members)}
        </div>
      ))}
      {data && data.flagged.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.9rem', margin: '12px 0 6px' }}>Flagged duplicates</h3>
          {memberTable(data.flagged)}
        </>
      )}
    </Card>
  );
}

function FormBuilderSection({
  sessionId,
  onError,
  onNotice,
}: {
  sessionId: string;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [fields, setFields] = useState<FormFieldRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoaded(false);
    if (!sessionId) {
      setFields([]);
      setLoaded(true);
      return;
    }
    try {
      setFields(await apiFetch<FormFieldRow[]>(`/admissions/sessions/${sessionId}/form-fields`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load form fields.');
    } finally {
      setLoaded(true);
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { code: '', label: '', fieldType: 'TEXT', placeholder: null, required: false, options: null, helpText: null, sequenceOrder: prev.length },
    ]);
  };

  const update = (index: number, key: keyof FormFieldRow, value: unknown) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  };

  const save = async () => {
    if (!sessionId) {
      onError('Select a session first.');
      return;
    }
    const clean = fields
      .filter((f) => f.code.trim() && f.label.trim())
      .map((f, i) => ({
        code: f.code.trim(),
        label: f.label.trim(),
        fieldType: f.fieldType,
        placeholder: f.placeholder || undefined,
        required: f.required,
        options: f.options && f.options.length ? f.options : undefined,
        helpText: f.helpText || undefined,
        sequenceOrder: f.sequenceOrder ?? i,
      }));
    if (clean.length === 0) {
      onError('Add at least one field with code and label.');
      return;
    }
    try {
      await apiFetch(`/admissions/sessions/${sessionId}/form-fields`, { method: 'POST', body: JSON.stringify({ fields: clean }) });
      onNotice('Form fields saved - applicants now see this form.');
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const parseOptions = (raw: string): string[] => raw.split(/[\s,;]+/).filter(Boolean);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>
          Application form builder {sessionId ? '' : '(select a session)'}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={addField}>Add field</Button>
          <Button onClick={() => void save()} disabled={!sessionId}>Save fields</Button>
        </div>
      </div>
      {!loaded && <p style={{ color: '#9ca3af' }}>Loading...</p>}
      {loaded && fields.length === 0 && <p style={{ color: '#9ca3af' }}>No custom fields yet - the default form is used. Saving replaces the whole field set.</p>}
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
          <Input label="Code" value={f.code} onChange={(e) => update(i, 'code', e.target.value)} style={{ width: 130 }} placeholder="caste" />
          <Input label="Label" value={f.label} onChange={(e) => update(i, 'label', e.target.value)} style={{ width: 150 }} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.85rem', color: '#374151' }}>Type</span>
            <select value={f.fieldType} onChange={(e) => update(i, 'fieldType', e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Input label="Options (comma)" value={(f.options ?? []).join(', ')} onChange={(e) => update(i, 'options', parseOptions(e.target.value))} style={{ width: 180 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
            <input type="checkbox" checked={f.required} onChange={(e) => update(i, 'required', e.target.checked)} />
            <span style={{ fontSize: '0.85rem', color: '#374151' }}>Required</span>
          </label>
          <Button variant="secondary" onClick={() => setFields((prev) => prev.filter((_, x) => x !== i))}>Remove</Button>
        </div>
      ))}
    </Card>
  );
}

function EligibilityRulesSection({
  sessionId,
  onError,
  onNotice,
}: {
  sessionId: string;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [programs, setPrograms] = useState<AdmissionProgramRow[]>([]);
  const [programId, setProgramId] = useState('');
  const [rules, setRules] = useState<EligibilityRuleRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [evaluateId, setEvaluateId] = useState('');
  const [evaluation, setEvaluation] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const q = new URLSearchParams();
        if (sessionId) q.set('sessionId', sessionId);
        const qs = q.toString();
        const p = await apiFetch<AdmissionProgramRow[]>(`/admissions/programs${qs ? `?${qs}` : ''}`);
        if (!cancelled) {
          setPrograms(p);
          setProgramId((cur) => cur || p[0]?.id || '');
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load programs.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onError]);

  const loadRules = useCallback(async () => {
    if (!programId) {
      setRules([]);
      return;
    }
    try {
      setRules(await apiFetch<EligibilityRuleRow[]>(`/admissions/eligibility-rules?programId=${programId}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load eligibility rules.');
    }
  }, [programId, onError]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const removeRule = async (ruleId: string) => {
    try {
      await apiFetch(`/admissions/eligibility-rules/${ruleId}`, { method: 'DELETE' });
      onNotice('Eligibility rule deleted.');
      void loadRules();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const evaluate = async () => {
    if (!evaluateId.trim()) {
      onError('Enter an application id.');
      return;
    }
    try {
      const res = await apiFetch<{ overall: string; rules: Array<{ outcome: string; detail: string; rule: { name: string } }> }>(
        `/admissions/applications/${evaluateId.trim()}/evaluate-eligibility`,
        { method: 'POST' },
      );
      setEvaluation(JSON.stringify(res, null, 2));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Evaluation failed.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Eligibility rules</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Program</label>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.program?.name ?? ''}</option>)}
            </select>
            <Button onClick={() => setShowForm((s) => !s)}>Add rule</Button>
          </div>
        </div>
        {showForm && (
          <RuleForm
            programId={programId}
            onDone={(msg) => {
              setShowForm(false);
              onNotice(msg);
              void loadRules();
            }}
            onError={onError}
          />
        )}
        {rules.length === 0 && <p style={{ color: '#9ca3af' }}>No rules for this program.</p>}
        {rules.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Category</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{r.name}</td>
                  <td style={{ padding: 8 }}>{r.ruleType}</td>
                  <td style={{ padding: 8 }}>{r.appliesToCategory ?? 'All'}</td>
                  <td style={{ padding: 8 }}>{r.isActive ? 'Active' : 'Inactive'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" onClick={() => void removeRule(r.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Evaluate eligibility</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Input label="Application id" value={evaluateId} onChange={(e) => setEvaluateId(e.target.value)} style={{ width: 320 }} />
          <Button onClick={() => void evaluate()}>Evaluate</Button>
        </div>
        {evaluation && (
          <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, overflowX: 'auto', fontSize: '0.8rem' }}>
            {evaluation}
          </pre>
        )}
      </Card>
    </>
  );
}

function RuleForm({
  programId,
  onDone,
  onError,
}: {
  programId: string;
  onDone: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [values, setValues] = useState({
    name: '',
    description: '',
    ruleType: 'MIN_PERCENTAGE',
    config: '',
    appliesToCategory: '',
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async () => {
    if (!programId) {
      onError('Select a program first.');
      return;
    }
    if (!values.name.trim()) {
      onError('Rule name is required.');
      return;
    }
    let config: Record<string, unknown> | undefined;
    if (values.config.trim()) {
      try {
        config = JSON.parse(values.config.trim()) as Record<string, unknown>;
      } catch {
        onError('Rule config must be valid JSON.');
        return;
      }
    }
    setBusy(true);
    try {
      await apiFetch('/admissions/eligibility-rules', {
        method: 'POST',
        body: JSON.stringify({
          programId,
          name: values.name.trim(),
          description: values.description.trim() || undefined,
          ruleType: values.ruleType,
          config,
          appliesToCategory: values.appliesToCategory.trim() || undefined,
          isActive: true,
        }),
      });
      onDone('Eligibility rule created.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>New eligibility rule</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Input label="Name *" value={values.name} onChange={set('name')} placeholder="Min 60% aggregate" />
        <Input label="Description" value={values.description} onChange={set('description')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Rule type</span>
          <select value={values.ruleType} onChange={set('ruleType')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            {RULE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <Input label="Applies to category (optional)" value={values.appliesToCategory} onChange={set('appliesToCategory')} placeholder="SC" />
        <Input label="Config (JSON)" value={values.config} onChange={set('config')} placeholder={RULE_CONFIG_PLACEHOLDER[values.ruleType]} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={() => void submit()} disabled={busy || !values.name.trim()}>Create rule</Button>
      </div>
    </Card>
  );
}

function BulkToolsSection({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [importJson, setImportJson] = useState('');
  const [verifyIds, setVerifyIds] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runImport = async () => {
    if (!importJson.trim()) {
      onError('Paste the applications JSON first.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson.trim());
    } catch {
      onError('Import payload must be valid JSON.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ total: number; created: number; failed: number; errors: Array<{ index: number; message: string }> }>(
        '/admissions/bulk/import',
        { method: 'POST', body: JSON.stringify(parsed) },
      );
      setResult(JSON.stringify(res, null, 2));
      onNotice(`Import complete: ${res.created}/${res.total} created.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async () => {
    const ids = verifyIds.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (ids.length === 0) {
      onError('Enter at least one application id.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ total: number; verified: number; failed: number; failedItems: Array<{ applicationId: string; message: string }> }>(
        '/admissions/bulk/verify',
        { method: 'POST', body: JSON.stringify({ applicationIds: ids }) },
      );
      setResult(JSON.stringify(res, null, 2));
      onNotice(`Bulk verification complete: ${res.verified}/${res.total} verified.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Bulk verify failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Bulk import applications</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>
          Paste a JSON body: {"{ \"applications\": [ ... ] }"} where each item is a create-application payload (sessionId, admissionProgramId, campusId, academicYearId, firstName, lastName, ...).
        </p>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          style={{ width: '100%', height: 140, padding: 8, borderRadius: 6, border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: '0.8rem' }}
          placeholder='{"applications": [{"sessionId": "...", "admissionProgramId": "...", "campusId": "...", "academicYearId": "...", "firstName": "Ravi", "lastName": "Kumar", "email": "ravi@example.com"}]}'
        />
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void runImport()} disabled={busy}>Import applications</Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Bulk verify applications</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>Space/comma/newline separated application ids. Eligible applications are also auto-scored.</p>
        <textarea
          value={verifyIds}
          onChange={(e) => setVerifyIds(e.target.value)}
          style={{ width: '100%', height: 90, padding: 8, borderRadius: 6, border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: '0.8rem' }}
          placeholder="uuid-1 uuid-2 uuid-3"
        />
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void runVerify()} disabled={busy}>Verify applications</Button>
        </div>
      </Card>

      {result && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Bulk result</h2>
          <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, overflowX: 'auto', fontSize: '0.8rem' }}>{result}</pre>
        </Card>
      )}
    </>
  );
}

function CommunicationSection({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [applicationId, setApplicationId] = useState('');
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [values, setValues] = useState({ subject: '', body: '', channel: 'IN_APP' });
  const [busy, setBusy] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!applicationId.trim()) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await apiFetch<MessageRow[]>(`/admissions/applications/${applicationId.trim()}/messages`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load messages.');
    }
  }, [applicationId, onError]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const send = async () => {
    if (!applicationId.trim() || !values.subject.trim() || !values.body.trim()) {
      onError('Application id, subject, and body are required.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/admissions/applications/${applicationId.trim()}/messages`, {
        method: 'POST',
        body: JSON.stringify({ subject: values.subject.trim(), body: values.body.trim(), channel: values.channel }),
      });
      onNotice('Message sent to the applicant thread.');
      setValues({ subject: '', body: '', channel: values.channel });
      void loadMessages();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Applicant communication</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Input label="Application id" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={{ width: 320 }} />
        </div>
        {applicationId && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 12 }}>
              <Input label="Subject *" value={values.subject} onChange={set('subject')} />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.85rem', color: '#374151' }}>Channel</span>
                <select value={values.channel} onChange={set('channel')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
                  {MESSAGE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
              <span style={{ fontSize: '0.85rem', color: '#374151' }}>Body *</span>
              <textarea value={values.body} onChange={set('body')} style={{ width: '100%', height: 90, padding: 8, borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.9rem' }} />
            </label>
            <div style={{ marginTop: 8 }}>
              <Button onClick={() => void send()} disabled={busy}>Send message</Button>
            </div>
          </>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Message thread</h2>
        {messages.length === 0 && <p style={{ color: '#9ca3af' }}>{applicationId ? 'No messages yet.' : 'Select an application to view its thread.'}</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
              <strong>{m.subject}</strong>
              <span style={{ color: '#6b7280' }}>{m.channel} - {new Date(m.sentAt).toLocaleString()}</span>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#374151' }}>{m.body}</p>
          </div>
        ))}
      </Card>
    </>
  );
}