import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ONBOARDING_OPTIONAL_STEPS,
  ONBOARDING_STEP_LABELS,
  ONBOARDING_STEPS,
  type OnboardingCompletionDto,
  type OnboardingImportResultDto,
  type OnboardingModuleOptionDto,
  type OnboardingPlanOptionDto,
  type OnboardingSessionDto,
  type OnboardingStep,
} from '@college-erp/types';
import { Badge, Button, Card, Checkbox, Input, Select, Spinner, useToast } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import {
  getOnboardingToken,
  onboardingApi,
  setOnboardingToken,
  uploadOnboardingLogo,
} from '../features/onboarding/onboarding-api';

const COLORS = ['#1d4ed8', '#0f766e', '#b91c1c', '#7c3aed', '#c2410c', '#0f172a'];

interface WizardForm {
  fullName: string;
  email: string;
  password: string;
  collegeName: string;
  slug: string;
  billingEmail: string;
  timezone: string;
  planCode: string;
  brandCollegeName: string;
  tagline: string;
  portalName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
  campusCode: string;
  campusName: string;
  campusCity: string;
  deptCode: string;
  deptName: string;
  progCode: string;
  progName: string;
  degreeLevel: string;
  yearCode: string;
  yearName: string;
  yearStart: string;
  yearEnd: string;
  termCode: string;
  termName: string;
  termStart: string;
  termEnd: string;
  enableModules: string[];
  importEntity: string;
  importCsv: string;
  adminEmail: string;
  adminFullName: string;
  adminPhone: string;
  adminPassword: string;
  channels: string[];
  senderName: string;
  senderEmail: string;
  supportEmail: string;
}

const EMPTY_FORM: WizardForm = {
  fullName: '',
  email: '',
  password: '',
  collegeName: '',
  slug: '',
  billingEmail: '',
  timezone: 'Asia/Kolkata',
  planCode: '',
  brandCollegeName: '',
  tagline: '',
  portalName: '',
  primaryColor: COLORS[0]!,
  secondaryColor: COLORS[5]!,
  logoUrl: '',
  campusCode: 'MAIN',
  campusName: 'Main Campus',
  campusCity: '',
  deptCode: '',
  deptName: '',
  progCode: '',
  progName: '',
  degreeLevel: 'Undergraduate',
  yearCode: String(new Date().getFullYear()),
  yearName: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
  yearStart: `${new Date().getFullYear()}-06-01`,
  yearEnd: `${new Date().getFullYear() + 1}-05-31`,
  termCode: 'SEM1',
  termName: 'Semester 1',
  termStart: '',
  termEnd: '',
  enableModules: [],
  importEntity: 'department',
  importCsv: '',
  adminEmail: '',
  adminFullName: '',
  adminPhone: '',
  adminPassword: '',
  channels: ['EMAIL', 'IN_APP'],
  senderName: '',
  senderEmail: '',
  supportEmail: '',
};

function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/**
 * Self-service college onboarding wizard (10 steps). Public — reachable without a session; the
 * opaque token minted at step 1 authorizes every later call. Progress is persisted server-side
 * (OnboardingSession), so a reload resumes where the user left off.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { push } = useToast();

  const [session, setSession] = useState<OnboardingSessionDto | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<OnboardingPlanOptionDto[]>([]);
  const [modules, setModules] = useState<OnboardingModuleOptionDto[]>([]);
  const [importResult, setImportResult] = useState<OnboardingImportResultDto | null>(null);
  const [completion, setCompletion] = useState<OnboardingCompletionDto | null>(null);

  const setField = useCallback(<K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applySession = useCallback((next: OnboardingSessionDto) => {
    setSession(next);
    setForm((prev) => ({
      ...prev,
      collegeName: prev.collegeName || next.tenantName || '',
      slug: prev.slug || next.tenantSlug || '',
      planCode: next.planCode ?? prev.planCode,
      adminEmail: next.adminEmail ?? prev.adminEmail,
      adminFullName: next.adminFullName ?? prev.adminFullName,
    }));
  }, []);

  // Resume an in-progress wizard from the persisted token.
  useEffect(() => {
    const token = getOnboardingToken();
    if (!token) {
      setResuming(false);
      return;
    }
    onboardingApi
      .getSession(token)
      .then((resumed) => {
        applySession(resumed);
        if (resumed.status === 'COMPLETED') {
          setStep(stepIndex('COMPLETE'));
        } else {
          setStep(Math.min(Math.max(resumed.currentStep - 1, 0), ONBOARDING_STEPS.length - 1));
        }
      })
      .catch(() => setOnboardingToken(null))
      .finally(() => setResuming(false));
  }, [applySession]);

  // Load the plan catalog when the plan step is shown.
  useEffect(() => {
    if (ONBOARDING_STEPS[step] !== 'PLAN' || plans.length > 0) return;
    onboardingApi.listPlans().then(setPlans).catch(() => undefined);
  }, [step, plans.length]);

  // Load the module catalog when the modules step is shown.
  useEffect(() => {
    if (ONBOARDING_STEPS[step] !== 'MODULES' || modules.length > 0) return;
    onboardingApi.listModules().then(setModules).catch(() => undefined);
  }, [step, modules.length]);

  const currentStep = ONBOARDING_STEPS[step]!;
  const completed = useMemo(() => new Set(session?.completedSteps ?? []), [session]);

  const run = useCallback(
    async (action: () => Promise<OnboardingSessionDto | void>, nextStep: OnboardingStep) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await action();
        if (updated) applySession(updated);
        setStep(stepIndex(nextStep));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [applySession],
  );

  // ── Step handlers ───────────────────────────────────────────────────────────

  const handleAccount = () =>
    run(async () => {
      const result = await onboardingApi.createAccount({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
      });
      setOnboardingToken(result.onboardingToken);
      return result.session;
    }, 'COLLEGE');

  const handleCollege = () =>
    run(
      () =>
        onboardingApi.createCollege({
          slug: form.slug,
          name: form.collegeName,
          billingEmail: form.billingEmail || undefined,
          timezone: form.timezone || undefined,
        }),
      'PLAN',
    );

  const handlePlan = () =>
    run(() => onboardingApi.selectPlan(form.planCode), 'BRANDING');

  const handleBranding = () =>
    run(
      () =>
        onboardingApi.configureBranding({
          collegeName: form.brandCollegeName || form.collegeName,
          tagline: form.tagline || undefined,
          portalName: form.portalName || undefined,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          logoUrl: form.logoUrl || undefined,
        }),
      'ACADEMIC_STRUCTURE',
    );

  const handleLogoFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await uploadOnboardingLogo(file);
      setField('logoUrl', url);
      push({ title: 'Logo uploaded', variant: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAcademic = () =>
    run(
      () =>
        onboardingApi.academicStructure({
          campuses: form.campusCode && form.campusName
            ? [{ code: form.campusCode, name: form.campusName, city: form.campusCity || undefined }]
            : undefined,
          departments: form.deptCode && form.deptName
            ? [{ code: form.deptCode, name: form.deptName, campusCode: form.campusCode || undefined }]
            : undefined,
          programs: form.progCode && form.progName
            ? [{ code: form.progCode, name: form.progName, degreeLevel: form.degreeLevel || undefined, departmentCode: form.deptCode || undefined }]
            : undefined,
          academicYear: form.yearCode && form.yearName
            ? { code: form.yearCode, name: form.yearName, startDate: form.yearStart, endDate: form.yearEnd, isCurrent: true }
            : undefined,
          terms: form.termCode && form.termName
            ? [{ code: form.termCode, name: form.termName, sequence: 1, startDate: form.termStart || undefined, endDate: form.termEnd || undefined, isCurrent: true }]
            : undefined,
        }),
      'MODULES',
    );

  const handleModules = () =>
    run(() => onboardingApi.configureModules({ enable: form.enableModules }), 'DATA_IMPORT');

  const handleImport = async (mode: 'validate' | 'upsert') => {
    setBusy(true);
    setError(null);
    try {
      const result = await onboardingApi.importData({ entity: form.importEntity, csv: form.importCsv, mode });
      setImportResult(result);
      if (mode === 'upsert') {
        setStep(stepIndex('ADMINISTRATOR'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdministrator = () =>
    run(
      () =>
        onboardingApi.createAdministrator({
          email: form.adminEmail || undefined,
          fullName: form.adminFullName || undefined,
          phone: form.adminPhone || undefined,
          password: form.adminPassword || undefined,
        }),
      'NOTIFICATIONS',
    );

  const handleNotifications = () =>
    run(
      () =>
        onboardingApi.configureNotifications({
          channels: form.channels,
          senderName: form.senderName || undefined,
          senderEmail: form.senderEmail || undefined,
          supportEmail: form.supportEmail || undefined,
        }),
      'COMPLETE',
    );

  const handleSkip = (step_: OnboardingStep) =>
    run(() => onboardingApi.skipStep(step_), ONBOARDING_STEPS[stepIndex(step_) + 1] ?? 'COMPLETE');

  const handleComplete = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await onboardingApi.complete();
      setCompletion(result);
      setOnboardingToken(null);
      // Best-effort auto sign-in with the administrator credentials captured during the wizard.
      try {
        await login(result.tenant.slug, result.admin.email, form.adminPassword || form.password);
        navigate('/dashboard');
      } catch {
        navigate(`/login?tenant=${encodeURIComponent(result.tenant.slug)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete onboarding.');
    } finally {
      setBusy(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (resuming) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem', gap: 10 }}>
        <Spinner /> <span>Loading…</span>
      </div>
    );
  }

  if (completion) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem' }}>
        <Card style={{ width: 520 }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>🎉 {completion.tenant.name} is ready!</h1>
          <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Your workspace is active. Sign in at <strong>{completion.tenant.slug}</strong> with{' '}
            <strong>{completion.admin.email}</strong>.
          </p>
          <ul style={{ fontSize: '0.85rem', color: '#374151', marginTop: 12 }}>
            <li>{completion.rolesCreated} default roles created</li>
            <li>{completion.permissionsGranted} permissions granted to the administrator</li>
            <li>Configuration initialized</li>
            <li>{completion.welcomeNotificationSent ? 'Welcome notification sent' : 'Welcome notification queued'}</li>
          </ul>
          <Button style={{ marginTop: 16 }} onClick={() => navigate('/login')}>
            Go to sign in
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 24, maxWidth: 1000, margin: '0 auto', paddingTop: '2.5rem' }}>
      <aside style={{ width: 240, flexShrink: 0 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>College setup</h2>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ONBOARDING_STEPS.map((s, index) => {
            const isDone = completed.has(s) || (session?.status === 'COMPLETED' && s === 'COMPLETE');
            const isCurrent = index === step;
            const reachable = index <= step || isDone;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => reachable && setStep(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: reachable ? 'pointer' : 'default',
                    background: isCurrent ? 'var(--ui-color-primary-soft, #eef2ff)' : 'transparent',
                    fontWeight: isCurrent ? 600 : 400,
                    color: reachable ? '#111827' : '#9ca3af',
                    fontSize: '0.85rem',
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      background: isDone ? '#16a34a' : isCurrent ? 'var(--ui-color-primary, #1d4ed8)' : '#e5e7eb',
                      color: isDone || isCurrent ? '#fff' : '#6b7280',
                    }}
                  >
                    {isDone ? '✓' : index + 1}
                  </span>
                  {ONBOARDING_STEP_LABELS[s]}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <div style={{ flex: 1, maxWidth: 560 }}>
        <Card>
          <h1 style={{ fontSize: '1.15rem', marginBottom: 4 }}>{ONBOARDING_STEP_LABELS[currentStep]}</h1>
          <p style={{ color: '#6b7280', fontSize: '0.82rem', marginTop: 0 }}>
            Step {step + 1} of {ONBOARDING_STEPS.length}
          </p>

          {currentStep === 'ACCOUNT' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label="Your full name" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} required />
              <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} required />
              <Input
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                hint="At least 10 characters with 3 character classes."
                required
              />
              <Button onClick={handleAccount} disabled={busy || !form.fullName || !form.email || !form.password}>
                {busy ? 'Creating…' : 'Create account'}
              </Button>
            </div>
          )}

          {currentStep === 'COLLEGE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label="College name" value={form.collegeName} onChange={(e) => setField('collegeName', e.target.value)} required />
              <Input
                label="Workspace slug"
                value={form.slug}
                onChange={(e) => setField('slug', e.target.value.toLowerCase())}
                hint="Lowercase letters, numbers and hyphens — used for your sign-in URL."
                required
              />
              <Input label="Billing email" type="email" value={form.billingEmail} onChange={(e) => setField('billingEmail', e.target.value)} />
              <Input label="Timezone" value={form.timezone} onChange={(e) => setField('timezone', e.target.value)} />
              <Button onClick={handleCollege} disabled={busy || !form.collegeName || !form.slug}>
                {busy ? 'Creating…' : 'Create college'}
              </Button>
            </div>
          )}

          {currentStep === 'PLAN' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plans.length === 0 && <Spinner />}
              {plans.map((plan) => (
                <label
                  key={plan.code}
                  style={{
                    display: 'block',
                    border: `1px solid ${form.planCode === plan.code ? 'var(--ui-color-primary, #1d4ed8)' : '#e5e7eb'}`,
                    borderRadius: 8,
                    padding: 12,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="plan"
                    checked={form.planCode === plan.code}
                    onChange={() => setField('planCode', plan.code)}
                    style={{ marginRight: 8 }}
                  />
                  <strong>{plan.name}</strong>
                  {plan.priceCents != null && (
                    <span style={{ color: '#6b7280', marginLeft: 8, fontSize: '0.85rem' }}>
                      ₹{(plan.priceCents / 100).toLocaleString('en-IN')} / {plan.billingCycle.toLowerCase()}
                    </span>
                  )}
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 6 }}>
                    {plan.features.length} modules · {plan.description ?? ''}
                  </div>
                </label>
              ))}
              <Button onClick={handlePlan} disabled={busy || !form.planCode}>
                {busy ? 'Saving…' : 'Continue'}
              </Button>
            </div>
          )}

          {currentStep === 'BRANDING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input label="Display name" value={form.brandCollegeName} onChange={(e) => setField('brandCollegeName', e.target.value)} placeholder={form.collegeName} />
              <Input label="Tagline" value={form.tagline} onChange={(e) => setField('tagline', e.target.value)} />
              <Input label="Portal name" value={form.portalName} onChange={(e) => setField('portalName', e.target.value)} />
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Primary color</div>
                  <input type="color" value={form.primaryColor} onChange={(e) => setField('primaryColor', e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Secondary color</div>
                  <input type="color" value={form.secondaryColor} onChange={(e) => setField('secondaryColor', e.target.value)} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 4 }}>Logo</div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoFile(file);
                  }}
                />
                {form.logoUrl && <div style={{ fontSize: '0.78rem', color: '#16a34a', marginTop: 4 }}>Logo ready ✓</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleBranding} disabled={busy}>
                  {busy ? 'Saving…' : 'Save branding'}
                </Button>
                <Button variant="secondary" onClick={() => handleSkip('BRANDING')} disabled={busy}>
                  Skip
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'ACADEMIC_STRUCTURE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Campus code" value={form.campusCode} onChange={(e) => setField('campusCode', e.target.value)} />
                <Input label="Campus name" value={form.campusName} onChange={(e) => setField('campusName', e.target.value)} />
              </div>
              <Input label="City" value={form.campusCity} onChange={(e) => setField('campusCity', e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Department code" value={form.deptCode} onChange={(e) => setField('deptCode', e.target.value)} placeholder="CSE" />
                <Input label="Department name" value={form.deptName} onChange={(e) => setField('deptName', e.target.value)} placeholder="Computer Science" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Program code" value={form.progCode} onChange={(e) => setField('progCode', e.target.value)} placeholder="BTECH-CSE" />
                <Input label="Program name" value={form.progName} onChange={(e) => setField('progName', e.target.value)} placeholder="B.Tech CSE" />
              </div>
              <Input label="Degree level" value={form.degreeLevel} onChange={(e) => setField('degreeLevel', e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Academic year code" value={form.yearCode} onChange={(e) => setField('yearCode', e.target.value)} />
                <Input label="Academic year name" value={form.yearName} onChange={(e) => setField('yearName', e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Year start" type="date" value={form.yearStart} onChange={(e) => setField('yearStart', e.target.value)} />
                <Input label="Year end" type="date" value={form.yearEnd} onChange={(e) => setField('yearEnd', e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input label="Term code" value={form.termCode} onChange={(e) => setField('termCode', e.target.value)} />
                <Input label="Term name" value={form.termName} onChange={(e) => setField('termName', e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleAcademic} disabled={busy}>
                  {busy ? 'Saving…' : 'Save structure'}
                </Button>
                <Button variant="secondary" onClick={() => handleSkip('ACADEMIC_STRUCTURE')} disabled={busy}>
                  Skip
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'MODULES' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {modules.length === 0 && <Spinner />}
              {modules.map((module) => (
                <div key={module.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Checkbox
                    label={
                      <span>
                        {module.name}{' '}
                        {module.includedInPlan && <Badge tone="info">In plan</Badge>}
                      </span>
                    }
                    checked={module.includedInPlan || form.enableModules.includes(module.key)}
                    disabled={module.includedInPlan}
                    onChange={(e) =>
                      setField(
                        'enableModules',
                        e.target.checked
                          ? [...form.enableModules, module.key]
                          : form.enableModules.filter((k) => k !== module.key),
                      )
                    }
                  />
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button onClick={handleModules} disabled={busy}>
                  {busy ? 'Saving…' : 'Save modules'}
                </Button>
                <Button variant="secondary" onClick={() => handleSkip('MODULES')} disabled={busy}>
                  Skip
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'DATA_IMPORT' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Select label="Entity" value={form.importEntity} onChange={(e) => setField('importEntity', e.target.value)}>
                {['campus', 'department', 'program', 'academicYear', 'term', 'room', 'building', 'section', 'batch'].map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </Select>
              <Input
                label="CSV (header row + data)"
                value={form.importCsv}
                onChange={(e) => setField('importCsv', e.target.value)}
                placeholder="code,name&#10;CSE,Computer Science"
                hint="Use the same columns as the organization import (code, name, ...)."
              />
              {importResult && (
                <div style={{ fontSize: '0.82rem', color: '#374151' }}>
                  {importResult.total} rows · {importResult.inserted} inserted · {importResult.updated} updated ·{' '}
                  {importResult.errors.length} errors
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => handleImport('validate')} disabled={busy || !form.importCsv}>
                  Validate
                </Button>
                <Button onClick={() => handleImport('upsert')} disabled={busy || !form.importCsv}>
                  {busy ? 'Importing…' : 'Import'}
                </Button>
                <Button variant="secondary" onClick={() => handleSkip('DATA_IMPORT')} disabled={busy}>
                  Skip
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'ADMINISTRATOR' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: 0 }}>
                This account becomes your first College Admin. Leave blank to use the account from step 1.
              </p>
              <Input label="Admin email" type="email" value={form.adminEmail} onChange={(e) => setField('adminEmail', e.target.value)} placeholder={form.email} />
              <Input label="Admin full name" value={form.adminFullName} onChange={(e) => setField('adminFullName', e.target.value)} placeholder={form.fullName} />
              <Input label="Phone" value={form.adminPhone} onChange={(e) => setField('adminPhone', e.target.value)} />
              <Input
                label="New password (optional)"
                type="password"
                value={form.adminPassword}
                onChange={(e) => setField('adminPassword', e.target.value)}
              />
              <Button onClick={handleAdministrator} disabled={busy}>
                {busy ? 'Saving…' : 'Continue'}
              </Button>
            </div>
          )}

          {currentStep === 'NOTIFICATIONS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: '0.85rem', color: '#374151' }}>Channels</div>
              {['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'].map((channel) => (
                <Checkbox
                  key={channel}
                  label={channel}
                  checked={form.channels.includes(channel)}
                  onChange={(e) =>
                    setField(
                      'channels',
                      e.target.checked ? [...form.channels, channel] : form.channels.filter((c) => c !== channel),
                    )
                  }
                />
              ))}
              <Input label="Sender name" value={form.senderName} onChange={(e) => setField('senderName', e.target.value)} placeholder={form.collegeName} />
              <Input label="Sender email" type="email" value={form.senderEmail} onChange={(e) => setField('senderEmail', e.target.value)} />
              <Input label="Support email" type="email" value={form.supportEmail} onChange={(e) => setField('supportEmail', e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={handleNotifications} disabled={busy}>
                  {busy ? 'Saving…' : 'Save notifications'}
                </Button>
                <Button variant="secondary" onClick={() => handleSkip('NOTIFICATIONS')} disabled={busy}>
                  Skip
                </Button>
              </div>
            </div>
          )}

          {currentStep === 'COMPLETE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: '0.9rem', color: '#374151' }}>
                Finishing activates <strong>{session?.tenantName ?? form.collegeName}</strong>, creates the default roles
                and permissions, initializes configuration, records an audit entry and sends a welcome notification.
              </p>
              <Button onClick={handleComplete} disabled={busy}>
                {busy ? 'Finishing…' : 'Complete onboarding'}
              </Button>
            </div>
          )}

          {error && <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: 12 }}>{error}</div>}

          {ONBOARDING_OPTIONAL_STEPS.includes(currentStep) && currentStep !== 'COMPLETE' && (
            <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 8 }}>This step is optional.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
