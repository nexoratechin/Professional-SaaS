import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { useAuth } from '../features/auth/auth-context';

interface PortalSessionRow {
  id: string;
  code: string;
  name: string;
  status: 'OPEN' | 'CLOSED';
  startAt: string;
  endAt: string;
  publicSlug: string | null;
  portalEnabled: boolean;
  portalOpenAt: string | null;
  portalCloseAt: string | null;
  portalInstructions: Record<string, unknown> | null;
  _count?: { applications: number };
}

/**
 * Admissions → Portal tab (D5). Publishes a session on the public /apply page and controls the
 * applicant-facing copy. Every field here maps 1:1 to PATCH /admissions/sessions/:id/portal; the
 * public form never exposes anything that is not configured here or in the module defaults.
 */
export function PortalTab({
  canManage,
  onError,
  onNotice,
}: {
  canManage: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const { tenantSlug } = useAuth();
  const [sessions, setSessions] = useState<PortalSessionRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState('');
  const [openAt, setOpenAt] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [consentVersion, setConsentVersion] = useState('v1');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [consentText, setConsentText] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await apiFetch<PortalSessionRow[]>('/admissions/sessions');
        if (!alive) return;
        setSessions(rows);
        setSelectedId((current) => current || rows[0]?.id || '');
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not load admission sessions.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [onError]);

  const selected = useMemo(() => sessions.find((row) => row.id === selectedId) ?? null, [sessions, selectedId]);

  useEffect(() => {
    if (!selected) return;
    const instructions = (selected.portalInstructions ?? {}) as Record<string, unknown>;
    setEnabled(selected.portalEnabled);
    setSlug(selected.publicSlug ?? '');
    setOpenAt(toLocalInput(selected.portalOpenAt));
    setCloseAt(toLocalInput(selected.portalCloseAt));
    setConsentVersion(typeof instructions.consentVersion === 'string' ? instructions.consentVersion : 'v1');
    setSupportEmail(typeof instructions.supportEmail === 'string' ? instructions.supportEmail : '');
    setSupportPhone(typeof instructions.supportPhone === 'string' ? instructions.supportPhone : '');
    setConsentText(typeof instructions.consentText === 'string' ? instructions.consentText : '');
  }, [selected]);

  const publicBase = `${window.location.origin}/apply/${tenantSlug ?? ''}`;

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await apiFetch<PortalSessionRow>(`/admissions/sessions/${selected.id}/portal`, {
        method: 'PATCH',
        body: JSON.stringify({
          portalEnabled: enabled,
          publicSlug: slug.trim() ? slug.trim().toLowerCase() : undefined,
          portalOpenAt: openAt ? new Date(openAt).toISOString() : undefined,
          portalCloseAt: closeAt ? new Date(closeAt).toISOString() : undefined,
          portalInstructions: {
            ...(consentVersion ? { consentVersion } : {}),
            ...(supportEmail ? { supportEmail } : {}),
            ...(supportPhone ? { supportPhone } : {}),
            ...(consentText ? { consentText } : {}),
          },
        }),
      });
      setSessions((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      onNotice(
        updated.portalEnabled && updated.publicSlug
          ? `Portal live at ${publicBase} (session "${updated.name}").`
          : 'Portal unpublished.',
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save the portal settings.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicBase);
      onNotice('Public application link copied.');
    } catch {
      onError('Could not copy the link — copy it from the box below.');
    }
  }

  if (loading) return <p style={{ color: '#6b7280' }}>Loading sessions…</p>;

  if (sessions.length === 0) {
    return (
      <Card>
        <CardBody>
          <p style={{ margin: 0 }}>Create an admission session first — the portal publishes a session, it does not replace one.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Public application link</h3>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ background: '#f3f4f6', padding: '8px 10px', borderRadius: 6, fontSize: '0.85rem' }}>{publicBase}</code>
            <Button variant="secondary" onClick={() => void copyLink()}>
              Copy link
            </Button>
          </div>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: 0 }}>
            Applicants see every session with the portal enabled. Print this link on brochures or share it from the college
            website.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Session settings</h3>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>Admission session</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                {sessions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.code}) — {row.status.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            {selected && (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={selected.portalEnabled && selected.publicSlug ? 'success' : 'neutral'}>
                    {selected.portalEnabled && selected.publicSlug ? 'Published' : 'Not published'}
                  </Badge>
                  <Badge tone="neutral">{selected.status}</Badge>
                  {selected._count && <Badge tone="info">{selected._count.applications} applications</Badge>}
                </div>

                <Checkbox
                  label="Accept online applications for this session"
                  checked={enabled}
                  disabled={!canManage}
                  onChange={(e) => setEnabled(e.target.checked)}
                />

                <Input
                  label="Link slug"
                  value={slug}
                  disabled={!canManage}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="ug-2027"
                  hint="Lowercase letters, digits and hyphens. Applicants never see it directly."
                />

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <Input
                    label="Portal opens"
                    type="datetime-local"
                    value={openAt}
                    disabled={!canManage}
                    onChange={(e) => setOpenAt(e.target.value)}
                    hint={`Defaults to ${new Date(selected.startAt).toLocaleString()}`}
                  />
                  <Input
                    label="Portal closes"
                    type="datetime-local"
                    value={closeAt}
                    disabled={!canManage}
                    onChange={(e) => setCloseAt(e.target.value)}
                    hint={`Defaults to ${new Date(selected.endAt).toLocaleString()}`}
                  />
                </div>

                <Input
                  label="Consent version"
                  value={consentVersion}
                  disabled={!canManage}
                  onChange={(e) => setConsentVersion(e.target.value)}
                  hint="Bump when the declaration text changes; applicants must accept the current version."
                />

                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <Input
                    label="Support email"
                    type="email"
                    value={supportEmail}
                    disabled={!canManage}
                    onChange={(e) => setSupportEmail(e.target.value)}
                  />
                  <Input
                    label="Support phone"
                    value={supportPhone}
                    disabled={!canManage}
                    onChange={(e) => setSupportPhone(e.target.value)}
                  />
                </div>

                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>Declaration text (optional override)</span>
                  <textarea
                    value={consentText}
                    disabled={!canManage}
                    onChange={(e) => setConsentText(e.target.value)}
                    rows={4}
                    placeholder="Leave blank to use the platform default consent text."
                    style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontFamily: 'inherit' }}
                  />
                </label>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button disabled={!canManage || saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save portal settings'}
                  </Button>
                  {selected.publicSlug && (
                    <Button
                      variant="secondary"
                      onClick={() => window.open(`${publicBase}`, '_blank', 'noopener')}
                    >
                      Preview portal
                    </Button>
                  )}
                </div>
                {!canManage && <p style={{ color: '#6b7280', margin: 0 }}>You need admissions manage permission to change these settings.</p>}
              </>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** ISO → the `YYYY-MM-DDTHH:mm` shape a datetime-local input expects (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
