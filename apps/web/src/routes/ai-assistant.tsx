/**
 * The AI ERP Assistant page (`/ai-assistant`).
 *
 * ## What this page is, and is not
 *
 * It is a client of `/ai-assistant/**`. It computes nothing: every number on screen came back in a
 * payload the API produced under the caller's *intersected* RBAC scope, and this page's job is to
 * show that payload honestly — including its caveats, its applied filters and the scope snapshot it
 * was computed under. If the page and the API ever disagreed, the API is right by construction.
 *
 * ## Gating
 *
 * Three independent gates, matching the server's three: `EntitlementRoute entitlement="ai.assistant"`
 * in App.tsx (the plan), `useEntitlement('ai.assistant')` here (belt and braces on a direct URL),
 * and per-action permission checks so a caller who may view but not create never sees a button that
 * would 403. None of this is enforcement — the guard stack and `resolveAiScope` are. It is
 * presentation, and it is deliberately conservative.
 *
 * ## Why the deterministic summary always shows
 *
 * A `DATA_WITH_NARRATION` answer has a model-phrased `answer` and a deterministic `summary` inside
 * the payload. Both are rendered, because the one thing a reader must be able to trust is the figure
 * the system computed, and the two are allowed to differ in wording but never in content.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AiCapabilitiesDto,
  AiConversationDto,
  AiConversationDetailDto,
  AiDocumentClassificationDto,
  AiDocumentClassificationListDto,
  AiDraftResponseDto,
  AiGeneratedReportDto,
  AiIntentDto,
  AiMessageDto,
  AiQueryResponseDto,
  AiRiskInsightsDto,
  AiRiskSeverityDto,
} from '@college-erp/types';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth, useEntitlement } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { AnswerBody, DraftPreview, ReportPreview, RiskPanel, ScopeNote } from './ai-assistant-ui';

const AI_VIEW = 'ai.view';
const AI_CREATE = 'ai.create';
const AI_EXPORT = 'ai.export';
const AI_UPDATE = 'ai.update';

type Tab = 'ask' | 'risks' | 'drafts' | 'reports' | 'classifications';

/** The shape `GET /ai-assistant/reports/catalog` returns (defined here — it is only used here). */
interface ReportCatalogEntry {
  reportType: string;
  name: string;
  description: string;
  category: string;
  sourcePermission: string;
  supportedFilters: string[];
  isGlobal: boolean;
}

const TABS: ReadonlyArray<{ id: Tab; label: string; permission: string }> = [
  { id: 'ask', label: 'Ask', permission: AI_VIEW },
  { id: 'risks', label: 'At-risk students', permission: AI_VIEW },
  { id: 'drafts', label: 'Drafts', permission: AI_CREATE },
  { id: 'reports', label: 'Reports', permission: AI_CREATE },
  { id: 'classifications', label: 'Document review', permission: AI_VIEW },
];

export function AiAssistantPage() {
  const entitled = useEntitlement('ai.assistant');
  const { permissions } = useAuth();

  const [capabilities, setCapabilities] = useState<AiCapabilitiesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ask');

  useEffect(() => {
    apiFetch<AiCapabilitiesDto>('/ai-assistant/capabilities')
      .then(setCapabilities)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load AI capabilities.'));
  }, []);

  // All hooks run before this early return, as React requires. `entitled` is false while the
  // entitlement map is still loading, so this also avoids a flash of a page the tenant cannot use.
  if (!entitled) return null;

  const visibleTabs = TABS.filter((candidate) => permissions.includes(candidate.permission));
  // A permission change (e.g. a role edit mid-session) can invalidate the selected tab; fall back to
  // the first tab the caller can actually see rather than rendering a body they may not request.
  const active = visibleTabs.some((candidate) => candidate.id === tab) ? tab : (visibleTabs[0]?.id ?? 'ask');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: '1.25rem' }}>AI Assistant</h1>
          <Link to="/dashboard" style={{ fontSize: '0.8rem' }}>
            &larr; Dashboard
          </Link>
        </div>
        {capabilities && (
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            Provider: <code>{capabilities.provider}</code>
            {capabilities.provider === 'none' ? ' (data answers work; narration and OCR do not)' : ''} · max{' '}
            {capabilities.maxRows} rows/answer
          </span>
        )}
      </div>

      {error && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>}
      {capabilities && !capabilities.enabled && (
        <Card>
          <p style={{ color: '#b45309', fontSize: '0.85rem' }}>
            The AI assistant is turned off for this deployment (<code>AI_ENABLED</code>). Every AI endpoint refuses
            regardless of your permissions.
          </p>
        </Card>
      )}

      <TabBar tabs={visibleTabs} active={active} onSelect={setTab} />
      <TabBody tab={active} capabilities={capabilities} permissions={permissions} />
    </div>
  );
}

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ id: Tab; label: string }>;
  active: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #e5e7eb', paddingBottom: 8 }}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant={tab.id === active ? 'primary' : 'secondary'}
          onClick={() => onSelect(tab.id)}
          style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem' }}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

function TabBody({
  tab,
  capabilities,
  permissions,
}: {
  tab: Tab;
  capabilities: AiCapabilitiesDto | null;
  permissions: string[];
}) {
  switch (tab) {
    case 'risks':
      return <RiskTab />;
    case 'drafts':
      return <DraftsTab canExport={permissions.includes(AI_EXPORT)} />;
    case 'reports':
      return <ReportsTab canExport={permissions.includes(AI_EXPORT)} />;
    case 'classifications':
      return <ClassificationsTab canReview={permissions.includes(AI_UPDATE)} />;
    default:
      return (
        <AskTab
          capabilities={capabilities}
          canCreate={permissions.includes(AI_CREATE)}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

function AskTab({ capabilities, canCreate }: { capabilities: AiCapabilitiesDto | null; canCreate: boolean }) {
  const [conversations, setConversations] = useState<AiConversationDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageDto[]>([]);
  const [question, setQuestion] = useState('');
  const [narrate, setNarrate] = useState(false);
  const [latest, setLatest] = useState<AiQueryResponseDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await apiFetch<AiConversationDto[]>('/ai-assistant/conversations'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations.');
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setLatest(null);
    try {
      const detail = await apiFetch<AiConversationDetailDto>(`/ai-assistant/conversations/${id}`);
      setMessages(detail.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the conversation.');
    }
  }, []);

  const ask = useCallback(async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<AiQueryResponseDto>('/ai-assistant/query', {
        method: 'POST',
        body: JSON.stringify({
          question,
          ...(activeId ? { conversationId: activeId } : {}),
          narrate,
        }),
      });
      setLatest(response);
      setActiveId(response.conversationId);
      setQuestion('');
      await loadConversations();
      await openConversation(response.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant could not answer.');
    } finally {
      setBusy(false);
    }
  }, [question, activeId, narrate, loadConversations, openConversation]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)', gap: 16 }}>
      <Card>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Conversations</h3>
        {conversations.length === 0 && <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>None yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => void openConversation(conversation.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid ' + (conversation.id === activeId ? '#1d4ed8' : '#e5e7eb'),
                  background: conversation.id === activeId ? '#eff6ff' : '#fff',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                {conversation.title} <span style={{ color: '#9ca3af' }}>({conversation.messageCount})</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        {!canCreate && (
          <p style={{ fontSize: '0.8rem', color: '#b45309' }}>
            Your role can read assistant history but not run queries (<code>ai.create</code>).
          </p>
        )}

        {capabilities && capabilities.availableIntents.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }}>Try one of:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {capabilities.availableIntents.map((intent) => (
                <button
                  key={intent.intent}
                  type="button"
                  disabled={!canCreate}
                  onClick={() => setQuestion(defaultQuestionFor(intent.intent))}
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: '1px solid #d1d5db',
                    background: '#f9fafb',
                    cursor: canCreate ? 'pointer' : 'not-allowed',
                  }}
                >
                  {intent.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Question"
          name="ai-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={!canCreate}
          placeholder="e.g. Which students have attendance below 75% this term?"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', marginTop: 8 }}>
          <input type="checkbox" checked={narrate} disabled={!canCreate} onChange={(event) => setNarrate(event.target.checked)} />
          Phrase the answer in prose (needs a configured provider)
        </label>
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void ask()} disabled={!canCreate || busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </div>

        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}

        {messages.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}

        {latest && (
          <div style={{ marginTop: 14, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 6 }}>
              Latest answer · intent <code>{latest.intent ?? 'unrouted'}</code> · {latest.responseKind} ·{' '}
              {latest.latencyMs} ms
            </div>
            <AnswerBody payload={latest.payload} />
            <div style={{ marginTop: 8 }}>
              <ScopeNote scope={latest.scope} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: AiMessageDto }) {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '100%',
        background: isUser ? '#eff6ff' : '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 10px',
      }}
    >
      <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
        {isUser ? 'You' : 'Assistant'} · {new Date(message.createdAt).toLocaleString()}
      </div>
      <p style={{ fontSize: '0.82rem', marginTop: 4, whiteSpace: 'pre-wrap' }}>{message.content}</p>
      {message.payload && !isUser && (
        <div style={{ marginTop: 8 }}>
          <AnswerBody payload={message.payload} />
        </div>
      )}
    </div>
  );
}

function defaultQuestionFor(intent: AiIntentDto): string {
  switch (intent) {
    case 'LOW_ATTENDANCE_STUDENTS':
      return 'Show students with attendance below 75%';
    case 'OUTSTANDING_FEES':
      return 'Who has outstanding fees?';
    case 'ADMISSIONS_STATISTICS':
      return 'How many admission applications came in this year?';
    case 'EXAM_PERFORMANCE':
      return 'What is the pass rate by subject?';
    case 'PLACEMENT_STATISTICS':
      return 'What is the placement rate and average package?';
    case 'DEPARTMENT_PERFORMANCE':
      return 'Compare department performance';
    case 'ANALYTICS_OVERVIEW':
      return 'Give me an overview of the college';
    case 'REPORT_GENERATION':
      return 'Generate an attendance report for the last 30 days';
    case 'COMMUNICATION_DRAFT':
      return 'Draft an email to guardians of students with low attendance';
    case 'STUDENT_RISK_INSIGHTS':
      return 'Which students are at risk of dropping out?';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Risk insights
// ---------------------------------------------------------------------------

function RiskTab() {
  const [severity, setSeverity] = useState<AiRiskSeverityDto | ''>('');
  const [data, setData] = useState<AiRiskInsightsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const query = severity ? `?severity=${severity}` : '';
      setData(await apiFetch<AiRiskInsightsDto>(`/ai-assistant/risk-insights${query}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load risk insights.');
    } finally {
      setBusy(false);
    }
  }, [severity]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="risk-severity" style={{ fontSize: '0.8rem', color: '#374151' }}>
              Severity
            </label>
            <select
              id="risk-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as AiRiskSeverityDto | '')}
              style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              <option value="">All</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            {busy ? 'Loading…' : 'Reload'}
          </Button>
        </div>
        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
      </Card>
      {data && <RiskPanel risks={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function DraftsTab({ canExport }: { canExport: boolean }) {
  const [question, setQuestion] = useState('Draft an email to guardians of students with low attendance');
  const [channel, setChannel] = useState('EMAIL');
  const [tone, setTone] = useState('FORMAL');
  const [audience, setAudience] = useState('GUARDIAN');
  const [result, setResult] = useState<AiDraftResponseDto | null>(null);
  const [recipientUserId, setRecipientUserId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setResult(
        await apiFetch<AiDraftResponseDto>('/ai-assistant/drafts', {
          method: 'POST',
          body: JSON.stringify({ question, channel, tone, audience }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft the message.');
    } finally {
      setBusy(false);
    }
  }, [question, channel, tone, audience]);

  const send = useCallback(async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await apiFetch<{ notificationId: string; scheduled: boolean }>('/ai-assistant/drafts/send', {
        method: 'POST',
        body: JSON.stringify({ messageId: result.messageId, recipientUserId }),
      });
      setNotice(`Queued as notification ${sent.notificationId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the draft.');
    } finally {
      setBusy(false);
    }
  }, [result, recipientUserId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        <Input label="What is the message about?" name="draft-question" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
          <SelectField label="Channel" value={channel} onChange={setChannel} options={['EMAIL', 'SMS', 'IN_APP']} />
          <SelectField label="Tone" value={tone} onChange={setTone} options={['FORMAL', 'FRIENDLY', 'FIRM']} />
          <SelectField label="Audience" value={audience} onChange={setAudience} options={['GUARDIAN', 'STUDENT', 'FACULTY', 'STAFF']} />
        </div>
        <div style={{ marginTop: 10 }}>
          <Button onClick={() => void generate()} disabled={busy || !question.trim()}>
            {busy ? 'Working…' : 'Generate draft'}
          </Button>
        </div>
        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
        {notice && <p style={{ color: '#15803d', fontSize: '0.82rem', marginTop: 8 }}>{notice}</p>}
      </Card>

      {result && (
        <>
          <DraftPreview draft={result.draft} />
          <Card>
            <h3 style={{ fontSize: '0.9rem' }}>Send</h3>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
              The body that will be delivered is the stored draft above — not anything typed here. Sending needs{' '}
              <code>notifications.send</code> as well as <code>ai.export</code>.
            </p>
            <div style={{ marginTop: 8, maxWidth: 420 }}>
              <Input
                label="Recipient user id (a user in this college)"
                name="draft-recipient"
                value={recipientUserId}
                onChange={(e) => setRecipientUserId(e.target.value)}
                placeholder="uuid"
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <Button
                variant="secondary"
                onClick={() => void send()}
                disabled={!canExport || busy || !recipientUserId.trim()}
              >
                Send draft
              </Button>
            </div>
            {!canExport && (
              <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 6 }}>
                Your role cannot send (<code>ai.export</code>).
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function ReportsTab({ canExport }: { canExport: boolean }) {
  const [catalog, setCatalog] = useState<ReportCatalogEntry[]>([]);
  const [reportType, setReportType] = useState('');
  const [title, setTitle] = useState('');
  const [report, setReport] = useState<AiGeneratedReportDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ReportCatalogEntry[]>('/ai-assistant/reports/catalog')
      .then((entries) => {
        setCatalog(entries);
        setReportType((current) => current || (entries[0]?.reportType ?? ''));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load the report catalog.'));
  }, []);

  const run = useCallback(
    async (mode: 'preview' | 'export') => {
      setBusy(true);
      setError(null);
      try {
        const path = mode === 'export' ? '/ai-assistant/reports/export' : '/ai-assistant/reports/generate';
        setReport(
          await apiFetch<AiGeneratedReportDto>(path, {
            method: 'POST',
            body: JSON.stringify({ reportType, ...(title ? { title } : {}), ...(mode === 'preview' ? {} : {}) }),
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate the report.');
      } finally {
        setBusy(false);
      }
    },
    [reportType, title],
  );

  const selected = catalog.find((entry) => entry.reportType === reportType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card>
        {catalog.length === 0 ? (
          <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>
            No report type is available to you: generating one needs <code>ai.view</code>, <code>reports.view</code> and
            the report&apos;s own source permission.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="report-type" style={{ fontSize: '0.8rem', color: '#374151' }}>
                  Report
                </label>
                <select
                  id="report-type"
                  value={reportType}
                  onChange={(event) => setReportType(event.target.value)}
                  style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  {catalog.map((entry) => (
                    <option key={entry.reportType} value={entry.reportType}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input label="Title (optional)" name="report-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {selected && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 8 }}>
                {selected.description} · needs <code>{selected.sourcePermission}</code>
                {selected.isGlobal ? ' · may include every row in the institution' : ''}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button onClick={() => void run('preview')} disabled={busy || !reportType}>
                {busy ? 'Working…' : 'Preview'}
              </Button>
              <Button variant="secondary" onClick={() => void run('export')} disabled={!canExport || busy || !reportType}>
                Export (saves + audits)
              </Button>
            </div>
          </>
        )}
        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
      </Card>
      {report && (
        <Card>
          <ReportPreview report={report} />
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document classifications
// ---------------------------------------------------------------------------

function ClassificationsTab({ canReview }: { canReview: boolean }) {
  const [items, setItems] = useState<AiDocumentClassificationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const page = await apiFetch<AiDocumentClassificationListDto>(
        '/ai-assistant/documents/classifications?unreviewedOnly=true&take=50',
      );
      setItems(page.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the review queue.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (id: string, decision: 'CONFIRM' | 'REJECT') => {
      setBusy(true);
      setError(null);
      try {
        await apiFetch(`/ai-assistant/documents/classifications/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ decision }),
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record the review.');
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.95rem' }}>Unreviewed classifications</h3>
        <Button variant="secondary" onClick={() => void load()} disabled={busy}>
          {busy ? 'Loading…' : 'Reload'}
        </Button>
      </div>
      {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
      {items.length === 0 && !busy && (
        <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: 8 }}>
          Nothing waiting. Queue a document version from the Documents screen to classify it.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {items.map((item) => (
          <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{item.documentTitle || item.originalFilename}</div>
                <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                  {item.status} · suggestion{' '}
                  <strong>{item.confirmedCategory ?? item.suggestedCategory ?? 'none'}</strong>
                  {item.confidence !== null ? ` (${Math.round(item.confidence * 100)}% confidence)` : ''}
                  {item.provider ? ` · ${item.provider}` : ''}
                </div>
              </div>
              {canReview && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => void review(item.id, 'CONFIRM')}
                    disabled={busy}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => void review(item.id, 'REJECT')}
                    disabled={busy}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
            {item.extractedText ? (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: '0.75rem',
                  color: '#4b5563',
                  marginTop: 8,
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              >
                {item.extractedText.slice(0, 600)}
              </pre>
            ) : (
              <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 6 }}>
                Extracted text is hidden — read access to documents (<code>documents.read</code>) is required.
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const id = `ai-select-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={id} style={{ fontSize: '0.8rem', color: '#374151' }}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db' }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
