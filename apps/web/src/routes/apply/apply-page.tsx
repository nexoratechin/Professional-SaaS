import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Input, Select } from '@college-erp/ui';
import { apiFetch, ApiError } from '../../lib/http';
import { brandingAssetUrl } from '../../features/branding/branding-context';
import {
  applicantTokenKey,
  formatDate,
  formatMoney,
  humaniseCategory,
  type PortalApplication,
  type PortalDocument,
  type PortalField,
} from './apply-helpers';

interface Branding {
  collegeName: string;
  tagline: string | null;
  primaryColor: string;
  logoUrl: string | null;
}

interface ProgramOption {
  offerId: string;
  name: string;
  code: string | null;
  degreeLevel: string | null;
  durationYears: number | null;
  seats: number;
  seatsAvailable: number | null;
  full: boolean;
  applicationFeeCents: number;
  admissionFeeCents: number;
}

interface PortalSession {
  publicSlug: string;
  name: string;
  academicYear: string | null;
  opensAt: string;
  closesAt: string;
  applicationFeeCents: number;
  admissionFeeCents: number;
  programs: ProgramOption[];
  supportEmail: string | null;
  supportPhone: string | null;
}

interface FormDefinition {
  session: { publicSlug: string; name: string; academicYear: string | null; opensAt: string; closesAt: string };
  fields: PortalField[];
  documentChecklist: string[];
  consentText: string;
  consentVersion: string;
  supportEmail: string | null;
  supportPhone: string | null;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  fees: { applicationFeeCents: number; admissionFeeCents: number; onlinePaymentAvailable: boolean };
}

type Phase = 'loading' | 'catalog' | 'verify' | 'form' | 'status' | 'error';

const CENTER: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '1.5rem 1rem 4rem' };
const MUTED: React.CSSProperties = { color: '#6b7280', fontSize: '0.9rem' };
const ROW: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' };

/**
 * Public admissions portal. Lives outside the authenticated route tree: the only credential is the
 * applicant token kept in sessionStorage for this college slug, and every call goes to
 * `/public/admissions/<slug>/...`. A tenant user's session is never used here.
 */
export function ApplyPage() {
  const { tenantSlug = '' } = useParams();
  const [params] = useSearchParams();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [branding, setBranding] = useState<Branding | null>(null);
  const [sessions, setSessions] = useState<PortalSession[]>([]);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [offer, setOffer] = useState<ProgramOption | null>(null);
  const [form, setForm] = useState<FormDefinition | null>(null);

  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(applicantTokenKey(tenantSlug)));
  const [application, setApplication] = useState<PortalApplication | null>(null);

  // ── Bootstrap: branding + open sessions, and an emailed resume link if present ────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [brand, catalog] = await Promise.all([
          apiFetch<Branding>(`/public/branding/${encodeURIComponent(tenantSlug)}`, { skipAuth: true }).catch(() => null),
          apiFetch<{ sessions: PortalSession[] }>(`/public/admissions/${encodeURIComponent(tenantSlug)}/sessions`, {
            skipAuth: true,
          }),
        ]);
        if (!alive) return;
        setBranding(brand);
        setSessions(catalog.sessions);

        const resume = params.get('resume');
        if (resume) {
          const resumed = await apiFetch<{ accessToken: string; applicationId: string | null }>(
            `/public/admissions/${encodeURIComponent(tenantSlug)}/applicant/resume`,
            { skipAuth: true, method: 'POST', body: JSON.stringify({ resumeToken: resume }) },
          );
          if (!alive) return;
          sessionStorage.setItem(applicantTokenKey(tenantSlug), resumed.accessToken);
          setToken(resumed.accessToken);
          setPhase('form');
          return;
        }

        setPhase('catalog');
      } catch (err) {
        if (!alive) return;
        setError(messageOf(err));
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      try {
        return await apiFetch<T>(`/public/admissions/${encodeURIComponent(tenantSlug)}${path}`, {
          ...init,
          skipAuth: true,
          bearerToken: token ?? undefined,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          sessionStorage.removeItem(applicantTokenKey(tenantSlug));
          setToken(null);
          setPhase('verify');
        }
        throw err;
      }
    },
    [tenantSlug, token],
  );

  // Returning with a token: restore the application view.
  useEffect(() => {
    if (!token || phase !== 'form' || application) return;
    let alive = true;
    (async () => {
      try {
        const mine = await call<{ applications: Array<{ id: string; publicReference: string | null; status: string }> }>('/me');
        if (!alive) return;
        const first = mine.applications[0];
        if (!first?.publicReference) return;
        const app = await call<PortalApplication>(`/track/${encodeURIComponent(first.publicReference)}`);
        if (!alive) return;
        setApplication(app);
      } catch {
        // A stale token simply drops the applicant back on the verify step.
        if (alive) setPhase('verify');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, phase, application, call]);

  const loadForm = useCallback(
    async (nextSession: PortalSession, nextOffer: ProgramOption | null) => {
      const definition = await apiFetch<FormDefinition>(
        `/public/admissions/${encodeURIComponent(tenantSlug)}/sessions/${encodeURIComponent(nextSession.publicSlug)}/form` +
          (nextOffer ? `?programOfferId=${encodeURIComponent(nextOffer.offerId)}` : ''),
        { skipAuth: true },
      );
      setForm(definition);
      return definition;
    },
    [tenantSlug],
  );

  async function chooseProgram(nextSession: PortalSession, nextOffer: ProgramOption) {
    setError(null);
    setSession(nextSession);
    setOffer(nextOffer);
    try {
      await loadForm(nextSession, nextOffer);
      setPhase(token ? 'form' : 'verify');
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function refreshApplication(): Promise<void> {
    if (!application?.reference) return;
    const fresh = await call<PortalApplication>(`/track/${encodeURIComponent(application.reference)}`);
    setApplication(fresh);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <PortalHeader branding={branding} accent={branding?.primaryColor ?? '#1d4ed8'} />

      <div style={CENTER}>
        {phase === 'loading' && <p style={MUTED}>Loading the admissions portal…</p>}

        {phase === 'error' && (
          <Card>
            <CardBody>
              <h2 style={{ marginTop: 0 }}>This portal is not available</h2>
              <p style={MUTED}>{error ?? 'Check the link with your college.'}</p>
            </CardBody>
          </Card>
        )}

        {phase === 'catalog' && (
          <CatalogStep
            sessions={sessions}
            onChoose={chooseProgram}
            error={error}
            support={sessions[0]?.supportEmail ?? null}
          />
        )}

        {phase === 'verify' && session && offer && (
          <VerifyStep
            slug={tenantSlug}
            sessionName={session.name}
            programName={offer.name}
            onVerified={(accessToken, applicationId) => {
              sessionStorage.setItem(applicantTokenKey(tenantSlug), accessToken);
              setToken(accessToken);
              setPhase('form');
              if (applicationId) {
                void refreshApplication().catch(() => undefined);
              }
            }}
            onBack={() => setPhase('catalog')}
            error={error}
            setError={setError}
          />
        )}

        {phase === 'form' && session && offer && form && (
          <ApplicationStep
            accessToken={token}
            slug={tenantSlug}
            session={session}
            offer={offer}
            form={form}
            application={application}
            onApplication={setApplication}
            onSubmitted={() => setPhase('status')}
            onBack={() => setPhase('status')}
            error={error}
            setError={setError}
            notice={notice}
            setNotice={setNotice}
          />
        )}

        {phase === 'status' && (
          <StatusStep
            application={application}
            fallbackReference={application?.reference ?? null}
            onRefresh={async (reference) => {
              const fresh = await call<PortalApplication>(`/track/${encodeURIComponent(reference)}`);
              setApplication(fresh);
            }}
            onOfferResponse={async (offerId, decision) => {
              const updated = await call<PortalApplication>(
                `/offers/${encodeURIComponent(offerId)}/${decision}`,
                { method: 'POST', body: JSON.stringify({}) },
              );
              setApplication(updated);
            }}
            onStartOver={() => {
              sessionStorage.removeItem(applicantTokenKey(tenantSlug));
              setToken(null);
              setApplication(null);
              setPhase('catalog');
            }}
            onContinue={() => setPhase('form')}
            error={error}
            setError={setError}
          />
        )}
      </div>
    </div>
  );
}

function PortalHeader({ branding, accent }: { branding: Branding | null; accent: string }) {
  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ ...CENTER, padding: '1rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        {branding?.logoUrl && (
          <img src={brandingAssetUrl(branding.logoUrl) as string} alt="" style={{ height: 40, width: 'auto' }} />
        )}
        <div>
          <div style={{ fontWeight: 700, color: accent }}>{branding?.collegeName ?? 'Admissions'}</div>
          <div style={MUTED}>{branding?.tagline ?? 'Online admission application'}</div>
        </div>
      </div>
    </header>
  );
}

function CatalogStep({
  sessions,
  onChoose,
  error,
  support,
}: {
  sessions: PortalSession[];
  onChoose: (session: PortalSession, offer: ProgramOption) => Promise<void>;
  error: string | null;
  support: string | null;
}) {
  const [sessionSlug, setSessionSlug] = useState(sessions[0]?.publicSlug ?? '');
  const [offerId, setOfferId] = useState('');
  const session = sessions.find((entry) => entry.publicSlug === sessionSlug) ?? sessions[0] ?? null;
  const offer = session?.programs.find((entry) => entry.offerId === offerId) ?? null;

  if (sessions.length === 0) {
    return (
      <Card>
        <CardBody>
          <h2 style={{ marginTop: 0 }}>Applications are closed</h2>
          <p style={MUTED}>There is no open admission session right now. Please check back later.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Apply online</h2>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 16 }}>
          {sessions.length > 1 && (
            <Select label="Admission session" value={sessionSlug} onChange={(e) => setSessionSlug(e.target.value)}>
              {sessions.map((entry) => (
                <option key={entry.publicSlug} value={entry.publicSlug}>
                  {entry.name}
                </option>
              ))}
            </Select>
          )}

          {session && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge tone="info">Closes {formatDate(session.closesAt)}</Badge>
                {session.academicYear && <Badge tone="neutral">{session.academicYear}</Badge>}
                <Badge tone="neutral">Application fee {formatMoney(session.applicationFeeCents)}</Badge>
              </div>

              <Select
                label="Programme"
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                hint="Choose the programme you are applying for."
              >
                <option value="">Select a programme…</option>
                {session.programs.map((program) => (
                  <option key={program.offerId} value={program.offerId} disabled={program.full}>
                    {program.name}
                    {program.full
                      ? ' — full'
                      : program.seatsAvailable !== null
                        ? ` — ${program.seatsAvailable} seat${program.seatsAvailable === 1 ? '' : 's'} left`
                        : ''}
                  </option>
                ))}
              </Select>

              {offer && (
                <div style={{ ...MUTED, display: 'grid', gap: 4 }}>
                  <span>Application fee: {formatMoney(offer.applicationFeeCents)}</span>
                  <span>Admission fee (on offer): {formatMoney(offer.admissionFeeCents)}</span>
                  <span>Fees are paid at the admissions office; nothing is charged online.</span>
                </div>
              )}

              {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

              <Button disabled={!offer} onClick={() => offer && void onChoose(session, offer)}>
                Continue
              </Button>
            </>
          )}

          {support && <p style={MUTED}>Need help? {support}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

function VerifyStep({
  slug,
  sessionName,
  programName,
  onVerified,
  onBack,
  error,
  setError,
}: {
  slug: string;
  sessionName: string;
  programName: string;
  onVerified: (accessToken: string, applicationId: string | null) => void;
  onBack: () => void;
  error: string | null;
  setError: (value: string | null) => void;
}) {
  const [channel, setChannel] = useState<'EMAIL' | 'PHONE'>('EMAIL');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'contact' | 'code'>('contact');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ sentTo: string; resendAfterSeconds: number }>(
        `/public/admissions/${encodeURIComponent(slug)}/applicant/otp`,
        { skipAuth: true, method: 'POST', body: JSON.stringify({ channel, contact: contact.trim() }) },
      );
      setSentTo(res.sentTo);
      setStage('code');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ accessToken: string; applicationId: string | null }>(
        `/public/admissions/${encodeURIComponent(slug)}/applicant/verify`,
        { skipAuth: true, method: 'POST', body: JSON.stringify({ channel, contact: contact.trim(), code: code.trim() }) },
      );
      onVerified(res.accessToken, res.applicationId);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Verify your {channel === 'EMAIL' ? 'email' : 'phone'}</h2>
        <p style={{ ...MUTED, margin: '4px 0 0' }}>
          {sessionName} · {programName}
        </p>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 14 }}>
          {stage === 'contact' ? (
            <>
              <Select
                label="Send the code to"
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'EMAIL' | 'PHONE')}
              >
                <option value="EMAIL">Email</option>
                <option value="PHONE">Phone (SMS)</option>
              </Select>
              <Input
                label={channel === 'EMAIL' ? 'Email address' : 'Phone number'}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={channel === 'EMAIL' ? 'you@example.com' : '+91 98765 43210'}
                hint="We use this to send your verification code and to identify your application."
              />
              {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button disabled={busy || contact.trim().length < 3} onClick={() => void sendCode()}>
                  {busy ? 'Sending…' : 'Send code'}
                </Button>
                <Button variant="secondary" onClick={onBack} disabled={busy}>
                  Back
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ ...MUTED, margin: 0 }}>A 6-digit code was sent to {sentTo ?? contact}.</p>
              <Input
                label="Verification code"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              />
              {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button disabled={busy || code.length < 4} onClick={() => void verify()}>
                  {busy ? 'Verifying…' : 'Verify and continue'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setStage('contact')}>
                  Change contact
                </Button>
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ApplicationStep({
  accessToken,
  slug,
  session,
  offer,
  form,
  application,
  onApplication,
  onSubmitted,
  onBack,
  error,
  setError,
  notice,
  setNotice,
}: {
  accessToken: string | null;
  slug: string;
  session: PortalSession;
  offer: ProgramOption;
  form: FormDefinition;
  application: PortalApplication | null;
  onApplication: (app: PortalApplication) => void;
  onSubmitted: () => void;
  onBack: () => void;
  error: string | null;
  setError: (value: string | null) => void;
  notice: string | null;
  setNotice: (value: string | null) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('NOT_SPECIFIED');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> =>
      apiFetch<T>(`/public/admissions/${encodeURIComponent(slug)}${path}`, {
        ...init,
        skipAuth: true,
        bearerToken: accessToken ?? undefined,
      }),
    [slug, accessToken],
  );

  async function startDraft() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<PortalApplication>('/applications', {
        method: 'POST',
        body: JSON.stringify({
          publicSlug: session.publicSlug,
          programOfferId: offer.offerId,
          firstName: firstName.trim(),
          middleName: middleName.trim() || undefined,
          lastName: lastName.trim(),
          gender,
          dateOfBirth: dateOfBirth || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          data: answers,
        }),
      });
      onApplication(created);
      setNotice('Draft saved. Upload your documents, then submit.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!application) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<PortalApplication>(`/applications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: firstName.trim() || undefined,
          middleName: middleName.trim(),
          lastName: lastName.trim() || undefined,
          gender,
          dateOfBirth: dateOfBirth || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          data: answers,
        }),
      });
      onApplication(updated);
      setNotice('Changes saved.');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!application) return;
    setBusy(true);
    setError(null);
    try {
      await api<PortalApplication>(`/applications/${application.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ consentVersion: form.consentVersion, declarationAccepted: consent }),
      });
      onSubmitted();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Your details</h2>
          <p style={{ ...MUTED, margin: '4px 0 0' }}>
            {session.name} · {offer.name}
          </p>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={ROW}>
              <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
              <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div style={ROW}>
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <Input label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
            <Select label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="NOT_SPECIFIED">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>

            {!application && (
              <Button disabled={busy || !firstName.trim() || !lastName.trim()} onClick={() => void startDraft()}>
                {busy ? 'Saving…' : 'Save and continue'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {application && (
        <>
          <Card>
            <CardHeader>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Application questions</h3>
            </CardHeader>
            <CardBody>
              <div style={{ display: 'grid', gap: 14 }}>
                {form.fields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={answers[field.key]}
                    onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
                {form.fields.length === 0 && <p style={MUTED}>No additional questions for this programme.</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" disabled={busy} onClick={() => void saveDraft()}>
                    Save changes
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          <DocumentsCard
            slug={slug}
            accessToken={accessToken}
            application={application}
            form={form}
            onUploaded={async () => {
              const fresh = await api<PortalApplication>(`/track/${encodeURIComponent(application.reference ?? '')}`);
              onApplication(fresh);
            }}
            onError={setError}
          />

          <Card>
            <CardHeader>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Declaration</h3>
            </CardHeader>
            <CardBody>
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={{ ...MUTED, margin: 0, whiteSpace: 'pre-wrap' }}>{form.consentText}</p>
                <Checkbox
                  label="I accept the declaration above"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                {application.missingDocuments.length > 0 && (
                  <p style={{ color: '#b45309', margin: 0 }}>
                    Still to upload: {application.missingDocuments.map(humaniseCategory).join(', ')}
                  </p>
                )}
                {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
                {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button disabled={busy || !consent} onClick={() => void submit()}>
                    {busy ? 'Submitting…' : 'Submit application'}
                  </Button>
                  <Button variant="secondary" onClick={onBack} disabled={busy}>
                    Back to status
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PortalField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === 'SELECT' && field.options?.length) {
    return (
      <Select label={field.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  if (field.type === 'MULTISELECT' && field.options?.length) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <div style={{ ...MUTED, marginBottom: 4 }}>{field.label}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {field.options.map((option) => (
            <Checkbox
              key={option}
              label={option}
              checked={selected.includes(option)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, option] : selected.filter((entry) => entry !== option))
              }
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <Input
      label={field.label}
      type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : 'text'}
      value={String(value ?? '')}
      hint={field.helpText ?? undefined}
      placeholder={field.placeholder ?? undefined}
      required={field.required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DocumentsCard({
  slug,
  accessToken,
  application,
  form,
  onUploaded,
  onError,
}: {
  slug: string;
  accessToken: string | null;
  application: PortalApplication;
  form: FormDefinition;
  onUploaded: () => Promise<void>;
  onError: (value: string | null) => void;
}) {
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(category: string, file: File) {
    setBusyCategory(category);
    onError(null);
    try {
      if (file.size > form.maxUploadBytes) {
        throw new Error(`Each file must be ${Math.round(form.maxUploadBytes / (1024 * 1024))} MB or smaller.`);
      }

      const base = `/public/admissions/${encodeURIComponent(slug)}/applications/${application.id}`;
      const reserved = await apiFetch<{
        documentId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>(`${base}/documents/upload-url`, {
        skipAuth: true,
        bearerToken: accessToken ?? undefined,
        method: 'POST',
        body: JSON.stringify({
          category,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });

      const put = await fetch(reserved.uploadUrl, { method: 'PUT', headers: reserved.headers, body: file });
      if (!put.ok) throw new Error('The upload did not complete. Check your connection and try again.');

      await apiFetch(`${base}/documents/${reserved.documentId}/confirm`, {
        skipAuth: true,
        bearerToken: accessToken ?? undefined,
        method: 'POST',
        body: JSON.stringify({}),
      });

      await onUploaded();
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setBusyCategory(null);
    }
  }

  const uploaded = useMemo(() => {
    const map = new Map<string, PortalDocument>();
    for (const doc of application.documents) map.set(doc.category.toUpperCase(), doc);
    return map;
  }, [application.documents]);

  return (
    <Card>
      <CardHeader>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Documents</h3>
        <p style={{ ...MUTED, margin: '4px 0 0' }}>
          PDF or image, up to {Math.round(form.maxUploadBytes / (1024 * 1024))} MB each. Files are scanned before staff review.
        </p>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 10 }}>
          {form.documentChecklist.map((category) => {
            const doc = uploaded.get(category.toUpperCase());
            return (
              <div
                key={category}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{humaniseCategory(category)}</div>
                  <div style={MUTED}>
                    {doc
                      ? `${doc.name} · ${doc.status.toLowerCase()}${doc.scanStatus ? ` · scan ${doc.scanStatus.toLowerCase()}` : ''}`
                      : 'Not uploaded yet'}
                  </div>
                </div>
                <div>
                  <input
                    ref={(el) => {
                      inputs.current[category] = el;
                    }}
                    type="file"
                    accept={form.allowedMimeTypes.join(',')}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(category, file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="secondary"
                    disabled={busyCategory !== null}
                    onClick={() => inputs.current[category]?.click()}
                  >
                    {busyCategory === category ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function StatusStep({
  application,
  fallbackReference,
  onRefresh,
  onOfferResponse,
  onStartOver,
  onContinue,
  error,
  setError,
}: {
  application: PortalApplication | null;
  fallbackReference: string | null;
  onRefresh: (reference: string) => Promise<void>;
  onOfferResponse: (offerId: string, decision: 'accept' | 'decline') => Promise<void>;
  onStartOver: () => void;
  onContinue: () => void;
  error: string | null;
  setError: (value: string | null) => void;
}) {
  const [reference, setReference] = useState(fallbackReference ?? '');
  const [busy, setBusy] = useState(false);

  if (!application) {
    return (
      <Card>
        <CardBody>
          <h2 style={{ marginTop: 0 }}>Track your application</h2>
          <p style={MUTED}>Enter the reference from your confirmation message.</p>
          <div style={{ display: 'grid', gap: 12 }}>
            <Input label="Application reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                disabled={busy || !reference.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onRefresh(reference.trim());
                  } catch (err) {
                    setError(messageOf(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Looking up…' : 'Find application'}
              </Button>
              <Button variant="secondary" onClick={onStartOver}>
                Start a new application
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  const offer = application.offers.find((entry) => entry.status === 'ISSUED');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{application.reference}</h2>
              <p style={{ ...MUTED, margin: '4px 0 0' }}>
                {application.program.name} · {application.session.name}
              </p>
            </div>
            <Badge tone="info">{application.status.replace(/_/g, ' ')}</Badge>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 8 }}>
            <span>Submitted: {formatDate(application.submittedAt)}</span>
            <span>Verified contact: {application.verifiedContact}</span>
            <span>
              Fee: {formatMoney(application.fee.applicationFeeCents)} · {application.fee.note}
            </span>
            {application.fee.receiptNumber && <span>Receipt: {application.fee.receiptNumber}</span>}
            {application.editable && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={onContinue}>
                  Continue editing
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {offer && (
        <Card>
          <CardHeader>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>You have an offer</h3>
          </CardHeader>
          <CardBody>
            <div style={{ display: 'grid', gap: 10 }}>
              <span>
                {offer.offerNumber} · respond by {formatDate(offer.expiresAt)}
              </span>
              <span>Admission fee: {formatMoney(offer.admissionFeeCents)} (payable at the office)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => void onOfferResponse(offer.id, 'accept')}>Accept offer</Button>
                <Button variant="secondary" onClick={() => void onOfferResponse(offer.id, 'decline')}>
                  Decline
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Documents</h3>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 8 }}>
            {application.checklist.map((category) => {
              const doc = application.documents.find((entry) => entry.category.toUpperCase() === category.toUpperCase());
              return (
                <div key={category} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{humaniseCategory(category)}</span>
                  <span style={MUTED}>
                    {doc ? `${doc.status.toLowerCase()}${doc.scanStatus ? ` · ${doc.scanStatus.toLowerCase()}` : ''}` : 'missing'}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>History</h3>
        </CardHeader>
        <CardBody>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {application.timeline.map((entry, index) => (
              <li key={`${entry.eventType}-${index}`}>
                <div style={{ fontWeight: 600 }}>{entry.title}</div>
                <div style={MUTED}>
                  {formatDate(entry.at)}
                  {entry.description ? ` · ${entry.description}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <div>
        <Button variant="secondary" onClick={onStartOver}>
          Sign out of this application
        </Button>
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
