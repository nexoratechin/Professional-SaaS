import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate } from './academics-shared';
import {
  CATEGORY_LABELS,
  CategoryBadge,
  EmptyState,
  ErrorBanner,
  FAILURE_CATEGORIES,
  INTEGRATION_CATEGORIES,
  INTEGRATION_STATUSES,
  JsonPreview,
  StatGrid,
  StatusBadge,
  SYNC_MODES,
  Table,
  Td,
  Th,
  FailureBadge,
} from './integrations-shared';

/** Existing catalog keys in packages/auth — reused, not redefined. */
export const INTEGRATIONS_VIEW_PERMISSION = 'integrations.view';
export const INTEGRATIONS_MANAGE_PERMISSION = 'integrations.manage';

type Tab = 'connections' | 'endpoints' | 'webhooks' | 'operations' | 'sync' | 'failures';

// ── Response shapes (must match what the API returns) ─────────────────────────

interface IntegrationRow {
  id: string;
  key: string;
  name: string;
  category: string;
  provider: string;
  direction: string;
  description: string | null;
  config: unknown;
  credentialKeys: string[];
  retryPolicy: unknown;
  status: string;
  isDefault: boolean;
  healthStatus: string;
  lastTestedAt: string | null;
  lastTestSucceededAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  syncCursor: string | null;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

interface EndpointRow {
  id: string;
  integrationId: string;
  name: string;
  pathToken: string;
  eventTypes: string[];
  signatureHeader: string;
  signatureAlgorithm: string;
  signatureToleranceSecs: number;
  isActive: boolean;
  lastEventAt: string | null;
  eventCount: number;
  failureCount: number;
  url: string;
  createdAt: string;
}

interface WebhookEventRow {
  id: string;
  eventType: string;
  status: string;
  signatureVerified: boolean;
  externalEventId: string | null;
  responseStatus: number | null;
  errorMessage: string | null;
  payload: unknown;
  receivedAt: string;
  processedAt: string | null;
  integration: { key: string; name: string } | null;
}

interface OperationRow {
  id: string;
  integrationId: string;
  operation: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  request: unknown;
  response: unknown;
  errorMessage: string | null;
  failureCategory: string | null;
  nextRetryAt: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface SyncRunRow {
  id: string;
  integrationId: string;
  status: string;
  trigger: string;
  direction: string;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errorMessage: string | null;
  hasMore: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  integration: { key: string; name: string } | null;
}

interface FailureRow {
  id: string;
  category: string;
  retryable: boolean;
  providerCode: string | null;
  message: string;
  details: unknown;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  integration: { key: string; name: string } | null;
}

interface SummaryResponse {
  byCategory: { category: string; healthStatus: string; count: number }[];
  unhealthy: number;
  openFailures: number;
}

interface CatalogResponse {
  categories: { category: string; providers: string[] }[];
}

interface Paged<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { permissions } = useAuth();
  const canManage = permissions.includes(INTEGRATIONS_MANAGE_PERMISSION);
  const [tab, setTab] = useState<Tab>('connections');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadCore = useCallback(async () => {
    setError(null);
    try {
      const [s, c, list] = await Promise.all([
        apiFetch<SummaryResponse>('/integrations/summary'),
        apiFetch<CatalogResponse>('/integrations/catalog'),
        apiFetch<Paged<IntegrationRow>>('/integrations?limit=200'),
      ]);
      setSummary(s);
      setCatalog(c);
      setIntegrations(list.items);
      setSelectedId((prev) => prev ?? list.items[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations.');
    }
  }, []);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  const selected = useMemo(
    () => integrations.find((i) => i.id === selectedId) ?? null,
    [integrations, selectedId],
  );

  const tabBar: { key: Tab; label: string; show: boolean }[] = [
    { key: 'connections', label: 'Connections', show: true },
    { key: 'endpoints', label: 'Webhook endpoints', show: selected !== null },
    { key: 'webhooks', label: 'Inbound events', show: true },
    { key: 'operations', label: 'Outbound operations', show: true },
    { key: 'sync', label: 'Sync runs', show: true },
    { key: 'failures', label: 'Failures', show: true },
  ];

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header>
        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Integrations</h1>
        <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>
          Configure connections to external systems — payments, accounting, LMS, biometric devices, SSO,
          documents, messaging — with credentials, connection testing, inbound webhooks, retries and sync.
        </p>
      </header>

      <ErrorBanner error={error} />
      {notice ? (
        <div
          style={{
            padding: '0.6rem 0.8rem',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 6,
            color: '#15803d',
            fontSize: '0.85rem',
            marginBottom: '0.75rem',
          }}
        >
          {notice}
        </div>
      ) : null}

      {summary ? (
        <StatGrid
          cards={[
            { label: 'Connections', value: String(integrations.length) },
            {
              label: 'Unhealthy',
              value: String(summary.unhealthy),
              color: summary.unhealthy > 0 ? '#b91c1c' : undefined,
            },
            {
              label: 'Open failures',
              value: String(summary.openFailures),
              color: summary.openFailures > 0 ? '#f59e0b' : undefined,
            },
            {
              label: 'Active',
              value: String(integrations.filter((i) => i.status === 'ACTIVE').length),
              color: '#15803d',
            },
          ]}
        />
      ) : null}

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabBar
          .filter((t) => t.show)
          .map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? 'primary' : 'secondary'}
              onClick={() => {
                setTab(t.key);
                setError(null);
                setNotice(null);
              }}
            >
              {t.label}
            </Button>
          ))}
      </nav>

      {tab === 'connections' && (
        <ConnectionsTab
          integrations={integrations}
          catalog={catalog}
          canManage={canManage}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChanged={loadCore}
          onError={setError}
          onNotice={setNotice}
        />
      )}

      {tab === 'endpoints' && selected && (
        <EndpointsTab integration={selected} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}

      {tab === 'webhooks' && <WebhookEventsTab integrationId={selected?.id} onError={setError} />}

      {tab === 'operations' && (
        <OperationsTab integrationId={selected?.id} canManage={canManage} onError={setError} />
      )}

      {tab === 'sync' && (
        <SyncTab integrationId={selected?.id} canManage={canManage} onError={setError} />
      )}

      {tab === 'failures' && <FailuresTab integrationId={selected?.id} canManage={canManage} onError={setError} />}
    </div>
  );
}

// ── Connections ───────────────────────────────────────────────────────────────

function ConnectionsTab(props: {
  integrations: IntegrationRow[];
  catalog: CatalogResponse | null;
  canManage: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { integrations, catalog, canManage, onSelect, onChanged, onError, onNotice } = props;
  const [creating, setCreating] = useState(false);

  return (
    <>
      {canManage && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Add a connection</h2>
            <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : 'New connection'}
            </Button>
          </div>
          {creating ? (
            <CreateIntegrationForm
              catalog={catalog}
              onDone={async () => {
                setCreating(false);
                await onChanged();
              }}
              onError={onError}
            />
          ) : (
            <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: 0 }}>
              A connection is created as a draft. Test it, then activate it — only active connections receive
              outbound calls or inbound webhooks.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Connections</h2>
        {integrations.length === 0 ? (
          <EmptyState
            message="No integrations configured yet."
            hint="Add one to connect a payment gateway, accounting system, LMS or messaging provider."
          />
        ) : (
          <Table head={['Name', 'Category', 'Provider', 'Status', 'Health', 'Last success', '']}>
            {integrations.map((i) => (
              <tr key={i.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{i.name}</div>
                  <code style={{ fontSize: '0.75rem', color: '#6b7280' }}>{i.key}</code>
                  {i.isDefault ? (
                    <span style={{ fontSize: '0.7rem', color: '#2563eb' }}> (default)</span>
                  ) : null}
                </Td>
                <Td>
                  <CategoryBadge value={i.category} />
                </Td>
                <Td>
                  <code style={{ fontSize: '0.8rem' }}>{i.provider}</code>
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{i.direction}</div>
                </Td>
                <Td>
                  <StatusBadge value={i.status} />
                </Td>
                <Td>
                  <StatusBadge value={i.healthStatus} />
                  {i.consecutiveFailures > 0 ? (
                    <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>{i.consecutiveFailures} consecutive</div>
                  ) : null}
                </Td>
                <Td>{fmtDate(i.lastSuccessAt)}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onSelect(i.id);
                      }}
                    >
                      {props.selectedId === i.id ? 'Selected' : 'Select'}
                    </Button>
                    {canManage ? <ConnectionActions integration={i} onChanged={onChanged} onError={onError} onNotice={onNotice} /> : null}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {integrations.length > 0 && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Selected connection</h2>
          <ConnectionDetail integration={integrations.find((i) => i.id === props.selectedId)} />
        </Card>
      )}
    </>
  );
}

function ConnectionDetail({ integration }: { integration?: IntegrationRow }) {
  if (!integration) {
    return <EmptyState message="No connection selected." hint="Pick one from the list above to see its detail." />;
  }
  return (
    <div style={{ fontSize: '0.85rem' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 6, margin: 0 }}>
        <dt style={{ color: '#6b7280' }}>Description</dt>
        <dd style={{ margin: 0 }}>{integration.description ?? '—'}</dd>

        <dt style={{ color: '#6b7280' }}>Capabilities</dt>
        <dd style={{ margin: 0 }}>
          {integration.capabilities.length > 0 ? integration.capabilities.join(', ') : '—'}
        </dd>

        {/*
          Credential KEY names only. The API never returns a decrypted secret, so this list is all a
          settings form can legitimately show — the point is that an operator can see "a token is
          configured" without the value ever leaving the server.
        */}
        <dt style={{ color: '#6b7280' }}>Credential fields set</dt>
        <dd style={{ margin: 0 }}>
          {integration.credentialKeys.length > 0 ? (
            integration.credentialKeys.map((k) => (
              <code key={k} style={{ marginRight: 6, fontSize: '0.75rem' }}>
                {k}
              </code>
            ))
          ) : (
            <span style={{ color: '#b91c1c' }}>none configured</span>
          )}
        </dd>

        <dt style={{ color: '#6b7280' }}>Retry policy</dt>
        <dd style={{ margin: 0 }}>
          <JsonPreview value={integration.retryPolicy} empty="framework defaults" />
        </dd>

        <dt style={{ color: '#6b7280' }}>Config</dt>
        <dd style={{ margin: 0 }}>
          <JsonPreview value={integration.config} />
        </dd>

        <dt style={{ color: '#6b7280' }}>Last tested</dt>
        <dd style={{ margin: 0 }}>
          {fmtDate(integration.lastTestedAt)}
          {integration.lastLatencyMs !== null ? ` (${integration.lastLatencyMs}ms)` : ''}
        </dd>

        <dt style={{ color: '#6b7280' }}>Sync cursor</dt>
        <dd style={{ margin: 0 }}>
          <JsonPreview value={integration.syncCursor} />
        </dd>

        {integration.lastErrorMessage ? (
          <>
            <dt style={{ color: '#6b7280' }}>Last error</dt>
            <dd style={{ margin: 0, color: '#b91c1c' }}>{integration.lastErrorMessage}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function ConnectionActions(props: {
  integration: IntegrationRow;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { integration, onChanged, onError, onNotice } = props;
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    onError(null);
    try {
      await fn();
      onNotice(successMessage);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          act(async () => {
            // The API returns the probe result rather than throwing on a failed test, so the message
            // is surfaced from the response: "test failed" is a legitimate outcome to report.
            const result = await apiFetch<{ ok: boolean; message: string; latencyMs: number }>(
              `/integrations/${integration.id}/test`,
              { method: 'POST' },
            );
            onNotice(result.ok ? `Connection OK (${result.latencyMs}ms): ${result.message}` : `Test failed: ${result.message}`);
          }, 'Connection test completed.')
        }
      >
        Test
      </Button>

      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          act(
            () =>
              apiFetch(`/integrations/${integration.id}/status`, {
                method: 'POST',
                body: JSON.stringify({ status: integration.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }),
              }).then(() => undefined),
            `Connection ${integration.status === 'ACTIVE' ? 'disabled' : 'activated'}.`,
          )
        }
      >
        {integration.status === 'ACTIVE' ? 'Disable' : 'Activate'}
      </Button>

      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          act(async () => {
            const body = prompt('New description (blank to clear)');
            if (body === null) return;
            await apiFetch(`/integrations/${integration.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ description: body }),
            });
          }, 'Connection updated.')
        }
      >
        Edit
      </Button>

      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          act(() => {
            // Deleting drops the endpoints, operations, sync ledger and failure history with it, so it
            // is confirmed explicitly rather than behind a two-click pattern that hides the scope.
            if (!window.confirm(`Delete "${integration.name}"? Its endpoints, operations, sync history and failure log are deleted too.`)) {
              return Promise.resolve();
            }
            return apiFetch(`/integrations/${integration.id}`, { method: 'DELETE' }).then(() => undefined);
          }, 'Connection deleted.')
        }
      >
        Delete
      </Button>
    </div>
  );
}

/**
 * Create form.
 *
 * Provider list comes from the API catalog rather than a hard-coded map, which is the frontend half of
 * the framework's vendor-neutrality: onboarding a provider that implements `http_json` needs no change
 * here at all.
 */
function CreateIntegrationForm(props: {
  catalog: CatalogResponse | null;
  onDone: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const { catalog, onDone, onError } = props;
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('PAYMENT_GATEWAY');
  const [provider, setProvider] = useState('http_json');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyHeader, setApiKeyHeader] = useState('x-api-key');
  const [authStyle, setAuthStyle] = useState('api_key_header');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // Memoized because the identity feeds a useEffect dependency: an inline `?? ['http_json']` would
  // hand the effect a fresh array every render and re-run it each time for no reason.
  const providers = useMemo(
    () => catalog?.categories.find((c) => c.category === category)?.providers ?? ['http_json'],
    [catalog, category],
  );

  useEffect(() => {
    // Switching category can leave the previously chosen provider unavailable (an SMS-only adapter on
    // a BIOMETRIC connection), which would otherwise submit an invalid pair and 400.
    const first = providers[0] ?? 'http_json';
    if (!providers.includes(provider)) setProvider(first);
  }, [providers, provider]);

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      const config: Record<string, unknown> = {};
      if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
      if (authStyle === 'api_key_header') {
        config.authStyle = 'api_key_header';
        config.apiKeyHeader = apiKeyHeader || 'x-api-key';
      } else {
        config.authStyle = authStyle;
      }

      const credentials: Record<string, unknown> = {};
      if (apiKey.trim()) credentials.apiKey = apiKey.trim();

      await apiFetch('/integrations', {
        method: 'POST',
        body: JSON.stringify({
          key: key.trim(),
          name: name.trim(),
          category,
          provider,
          description: description.trim() || undefined,
          config,
          credentials,
        }),
      });
      // The plaintext key lives in component state only and is cleared immediately: it is never
      // rendered back anywhere, because the API will not return it.
      setApiKey('');
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create the connection.');
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        <label style={fieldStyle}>
          Key (slug, used in URLs)
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="stripe-payments" />
        </label>
        <label style={fieldStyle}>
          Display name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stripe" />
        </label>
        <label style={fieldStyle}>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            {INTEGRATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Provider adapter
          <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Base URL
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.vendor.com/v1" />
        </label>
        <label style={fieldStyle}>
          Auth style
          <select value={authStyle} onChange={(e) => setAuthStyle(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="api_key_header">API key header</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic (user + secret)</option>
            <option value="query">API key in query string</option>
            <option value="none">No auth</option>
          </select>
        </label>
        {authStyle === 'api_key_header' ? (
          <label style={fieldStyle}>
            API key header name
            <Input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} placeholder="x-api-key" />
          </label>
        ) : null}
        <label style={fieldStyle}>
          API key / token (stored encrypted)
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk_live_…" />
        </label>
      </div>

      <label style={fieldStyle}>
        Description
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Card payments via Stripe" />
      </label>

      <div>
        <Button variant="primary" disabled={busy || !key.trim() || !name.trim()} onClick={submit}>
          {busy ? 'Creating…' : 'Create draft connection'}
        </Button>
      </div>
    </div>
  );
}

// ── Webhook endpoints ─────────────────────────────────────────────────────────

function EndpointsTab(props: {
  integration: IntegrationRow;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { integration, canManage, onError, onNotice } = props;
  const [rows, setRows] = useState<EndpointRow[]>([]);
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);
  const [name, setName] = useState('');
  const [algorithm, setAlgorithm] = useState('HMAC_SHA256');
  const [header, setHeader] = useState('x-integration-signature');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<EndpointRow[]>(`/integrations/${integration.id}/webhook-endpoints`);
      setRows(res);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load endpoints.');
    }
  }, [integration.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    onError(null);
    try {
      const created = await apiFetch<EndpointRow & { signingSecret: string }>(
        `/integrations/${integration.id}/webhook-endpoints`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            signatureAlgorithm: algorithm,
            signatureHeader: header,
          }),
        },
      );
      // Shown once and never retrievable again — the API stores only the ciphertext.
      setNewSecret({ url: `${window.location.origin}${created.url}`, secret: created.signingSecret });
      setName('');
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create the endpoint.');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (endpoint: EndpointRow) => {
    if (!window.confirm(`Rotate "${endpoint.name}"? The previous URL stops working immediately.`)) return;
    try {
      const res = await apiFetch<EndpointRow & { signingSecret: string }>(
        `/integrations/${integration.id}/webhook-endpoints/${endpoint.id}/rotate`,
        { method: 'POST' },
      );
      setNewSecret({ url: `${window.location.origin}${res.url}`, secret: res.signingSecret });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to rotate.');
    }
  };

  const toggle = async (endpoint: EndpointRow) => {
    try {
      await apiFetch(`/integrations/${integration.id}/webhook-endpoints/${endpoint.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !endpoint.isActive }),
      });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update the endpoint.');
    }
  };

  const remove = async (endpoint: EndpointRow) => {
    if (!window.confirm(`Delete "${endpoint.name}"? Its received events are deleted too.`)) return;
    try {
      await apiFetch(`/integrations/${integration.id}/webhook-endpoints/${endpoint.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to delete the endpoint.');
    }
  };

  return (
    <>
      {/*
        Copy-it-now banner. There is deliberately no "reveal secret" button anywhere in this UI,
        because the API cannot serve one — the secret exists only in this response.
      */}
      {newSecret ? (
        <Card style={{ borderColor: '#15803d' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.95rem', margin: 0, color: '#15803d' }}>Copy these now</h3>
            <Button variant="secondary" onClick={() => setNewSecret(null)}>
              Done
            </Button>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: '6px 0' }}>
            The signing secret is shown once and cannot be retrieved again. Paste it into the provider's
            dashboard before leaving this page.
          </p>
          <div style={{ fontSize: '0.8rem' }}>
            <div style={{ marginBottom: 6 }}>
              <strong>URL:</strong> <code style={{ wordBreak: 'break-all' }}>{newSecret.url}</code>
            </div>
            <div>
              <strong>Secret:</strong> <code style={{ wordBreak: 'break-all' }}>{newSecret.secret}</code>
            </div>
          </div>
        </Card>
      ) : null}

      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Add an endpoint</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="payment-events" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
              Signature algorithm
              <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
                <option value="HMAC_SHA256">HMAC-SHA256</option>
                <option value="HMAC_SHA256_TS">HMAC-SHA256 with timestamp</option>
                <option value="HMAC_SHA256_PREFIXED">Prefixed signature</option>
                <option value="BEARER_TOKEN">Bearer token</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
              Signature header
              <Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="x-integration-signature" />
            </label>
            <Button variant="primary" disabled={busy || !name.trim()} onClick={create}>
              Create endpoint
            </Button>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 0 }}>
            Deliveries are signature-verified against the raw request body. An unsigned or mismatched
            delivery is recorded as a failure and rejected — never processed.
          </p>
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Endpoints for {integration.name}</h2>
        {rows.length === 0 ? (
          <EmptyState
            message="No webhook endpoints yet."
            hint="Create one to receive callbacks from this provider, then paste the URL and signing secret into the provider's dashboard."
          />
        ) : (
          <Table head={['Name', 'URL', 'Algorithm', 'Active', 'Events', 'Failures', '']}>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>tolerance {r.signatureToleranceSecs}s</div>
                </Td>
                <Td>
                  <code style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>{r.url}</code>
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>header: {r.signatureHeader}</div>
                </Td>
                <Td>
                  <code style={{ fontSize: '0.72rem' }}>{r.signatureAlgorithm}</code>
                </Td>
                <Td>
                  <StatusBadge value={r.isActive ? 'ACTIVE' : 'DISABLED'} />
                </Td>
                <Td>{r.eventCount}</Td>
                <Td style={{ color: r.failureCount > 0 ? '#b91c1c' : undefined }}>{r.failureCount}</Td>
                <Td>
                  {canManage ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="secondary" onClick={() => toggle(r)}>
                        {r.isActive ? 'Pause' : 'Resume'}
                      </Button>
                      <Button variant="secondary" onClick={() => rotate(r)}>
                        Rotate
                      </Button>
                      <Button variant="secondary" onClick={() => remove(r)}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function WebhookEventsTab({ integrationId, onError }: { integrationId?: string; onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<WebhookEventRow[]>([]);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (integrationId) qs.set('integrationId', integrationId);
      if (filter.trim()) qs.set('status', filter.trim().toUpperCase());
      const res = await apiFetch<Paged<WebhookEventRow>>(`/integrations/webhook-events?${qs.toString()}`);
      setRows(res.items);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load webhook events.');
    }
  }, [integrationId, filter, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Inbound events</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Filter by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }}
          />
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No inbound events recorded." hint="Events appear here as soon as a provider delivers one." />
      ) : (
        <Table head={['Received', 'Event', 'Status', 'Signature', 'Response', 'Integration', '']}>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <Td>{fmtDate(r.receivedAt)}</Td>
              <Td>
                <code style={{ fontSize: '0.78rem' }}>{r.eventType}</code>
                {r.externalEventId ? (
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>id: {r.externalEventId}</div>
                ) : null}
              </Td>
              <Td>
                <StatusBadge value={r.status} />
                {r.errorMessage ? (
                  <div style={{ fontSize: '0.72rem', color: '#b91c1c', maxWidth: 260 }}>{r.errorMessage}</div>
                ) : null}
              </Td>
              <Td>
                <span style={{ color: r.signatureVerified ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                  {r.signatureVerified ? 'verified' : 'rejected'}
                </span>
              </Td>
              <Td>{r.responseStatus ?? '—'}</Td>
              <Td>{r.integration?.name ?? '—'}</Td>
              <Td>
                <Button
                  variant="secondary"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  {expanded === r.id ? 'Hide' : 'Payload'}
                </Button>
                {expanded === r.id ? (
                  <div style={{ marginTop: 6, maxWidth: 460 }}>
                    <JsonPreview value={r.payload} />
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function OperationsTab(props: {
  integrationId?: string;
  canManage: boolean;
  onError: (m: string | null) => void;
}) {
  const { canManage, onError } = props;
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (props.integrationId) qs.set('integrationId', props.integrationId);
      const res = await apiFetch<Paged<OperationRow>>(`/integrations/operations?${qs.toString()}`);
      setRows(res.items);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load operations.');
    }
  }, [props.integrationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (row: OperationRow) => {
    setBusyId(row.id);
    onError(null);
    try {
      await apiFetch(`/integrations/operations/retry/${row.id}`, { method: 'GET' });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Retry failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Outbound operations</h2>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No outbound operations yet." hint="Operations are created when the ERP calls a configured provider." />
      ) : (
        <Table head={['Created', 'Operation', 'Status', 'Attempts', 'Latency', 'Error', '']}>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <Td>{fmtDate(r.createdAt)}</Td>
              <Td>
                <code style={{ fontSize: '0.78rem' }}>{r.operation}</code>
                {r.idempotencyKey ? (
                  <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>key: {r.idempotencyKey.slice(0, 16)}…</div>
                ) : null}
              </Td>
              <Td>
                <StatusBadge value={r.status} />
                {r.failureCategory ? (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                    <FailureBadge value={r.failureCategory} />
                  </div>
                ) : null}
              </Td>
              <Td>
                {r.attempt}/{r.maxAttempts}
                {r.nextRetryAt ? (
                  <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>retry {fmtDate(r.nextRetryAt)}</div>
                ) : null}
              </Td>
              <Td>{r.latencyMs !== null ? `${r.latencyMs}ms` : '—'}</Td>
              <Td style={{ maxWidth: 260, fontSize: '0.78rem', color: r.errorMessage ? '#b91c1c' : undefined }}>
                {r.errorMessage ?? '—'}
              </Td>
              <Td>
                {/* Only a terminal FAILED operation is retryable: re-dispatching one that is still
                    queued would call the provider twice for the same request. */}
                {canManage && r.status === 'FAILED' ? (
                  <Button variant="secondary" disabled={busyId === r.id} onClick={() => retry(r)}>
                    Retry
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function SyncTab(props: { integrationId?: string; canManage: boolean; onError: (m: string | null) => void }) {
  const { canManage, onError } = props;
  const [rows, setRows] = useState<SyncRunRow[]>([]);
  const [entityType, setEntityType] = useState('student');
  const [mode, setMode] = useState<string>('PULL_SYNC');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (props.integrationId) qs.set('integrationId', props.integrationId);
      const res = await apiFetch<Paged<SyncRunRow>>(`/integrations/sync-runs?${qs.toString()}`);
      setRows(res.items);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load sync runs.');
    }
  }, [props.integrationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    if (!props.integrationId) {
      onError('Select a connection on the Connections tab first.');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/integrations/${props.integrationId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ entityType: entityType.trim(), mode }),
      });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to start the sync.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (row: SyncRunRow) => {
    try {
      await apiFetch(`/integrations/sync-runs/${row.id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to cancel the run.');
    }
  };

  return (
    <>
      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Start a sync run</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
              Entity type
              <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="student" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
                {SYNC_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" disabled={busy || !props.integrationId} onClick={start}>
              {busy ? 'Starting…' : 'Start run'}
            </Button>
          </div>
          {!props.integrationId ? (
            <p style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: 0 }}>
              Select a connection on the Connections tab first.
            </p>
          ) : null}
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Sync runs</h2>
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No sync runs yet." hint="Runs are recorded here with their counters, cursor and outcome." />
        ) : (
          <Table head={['Started', 'Integration', 'Status', 'Trigger', 'Progress', 'More?', '']}>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <Td>{fmtDate(r.startedAt ?? r.createdAt)}</Td>
                <Td>{r.integration?.name ?? '—'}</Td>
                <Td>
                  <StatusBadge value={r.status} />
                  {r.errorMessage ? (
                    <div style={{ fontSize: '0.72rem', color: '#b91c1c', maxWidth: 260 }}>{r.errorMessage}</div>
                  ) : null}
                </Td>
                <Td>{r.trigger}</Td>
                <Td style={{ fontSize: '0.78rem' }}>
                  <span style={{ color: '#15803d' }}>{r.succeeded} ok</span> ·{' '}
                  <span style={{ color: '#b91c1c' }}>{r.failed} failed</span> · {r.skipped} unchanged / {r.attempted} seen
                </Td>
                <Td>{r.hasMore ? 'yes' : 'no'}</Td>
                <Td>
                  {canManage && (r.status === 'PENDING' || r.status === 'RUNNING') ? (
                    <Button variant="secondary" onClick={() => cancel(r)}>
                      Cancel
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function FailuresTab(props: { integrationId?: string; canManage: boolean; onError: (m: string | null) => void }) {
  const { canManage, onError } = props;
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [category, setCategory] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (props.integrationId) qs.set('integrationId', props.integrationId);
      if (category) qs.set('category', category);
      if (onlyOpen) qs.set('resolved', 'false');
      const res = await apiFetch<Paged<FailureRow>>(`/integrations/failures?${qs.toString()}`);
      setRows(res.items);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load failures.');
    }
  }, [props.integrationId, category, onlyOpen, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (row: FailureRow) => {
    try {
      await apiFetch(`/integrations/failures/${row.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolved: true, note: 'Triaged from the integrations page.' }),
      });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to resolve the failure.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', margin: 0, flex: 1 }}>Failures</h2>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }}
        >
          <option value="">All categories</option>
          {FAILURE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <label style={{ fontSize: '0.8rem', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Unresolved only
        </label>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No failures recorded." hint="Every failed attempt — outbound, inbound or sync — is logged here." />
      ) : (
        <Table head={['When', 'Category', 'Integration', 'Message', 'Retryable', 'Resolved', '']}>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <Td>{fmtDate(r.createdAt)}</Td>
              <Td>
                <FailureBadge value={r.category} />
                {r.providerCode ? (
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>code {r.providerCode}</div>
                ) : null}
              </Td>
              <Td>{r.integration?.name ?? '—'}</Td>
              <Td style={{ maxWidth: 340, fontSize: '0.8rem' }}>{r.message}</Td>
              <Td>{r.retryable ? 'yes' : 'no'}</Td>
              <Td>
                {r.resolvedAt ? (
                  <span style={{ color: '#15803d' }}>{fmtDate(r.resolvedAt)}</span>
                ) : (
                  <span style={{ color: '#f59e0b' }}>open</span>
                )}
              </Td>
              <Td>
                {canManage && !r.resolvedAt ? (
                  <Button variant="secondary" onClick={() => resolve(r)}>
                    Resolve
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}