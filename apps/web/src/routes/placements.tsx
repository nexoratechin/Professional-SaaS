/**
 * Placement Management page — recruiting companies & contacts, drives & positions with
 * eligibility evaluation, applications with rounds/results, selections, offers & joining, and
 * closing-the-books outcomes with statistics/reports. Row-level student scope is enforced by the
 * API (placements.view/create/update/approve + grant scopes), so the UI only renders actions the
 * current user holds via useAuth().permissions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import type {
  PlacementApplicationDto,
  PlacementCompanyDto,
  PlacementContactDto,
  PlacementDriveDto,
  PlacementEligibilityDto,
  PlacementJoiningDto,
  PlacementOfferDto,
  PlacementOutcomeDto,
  PlacementPositionDto,
  PlacementReportDto,
  PlacementRoundDto,
  PlacementRoundResultDto,
  PlacementStatisticsDto,
} from '@college-erp/types';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import {
  APPLICATION_STATUSES,
  COMPANY_TYPES,
  DRIVE_MODES,
  DRIVE_STATUSES,
  ELIGIBILITY_STATUSES,
  JOINING_STATUSES,
  OFFER_STATUSES,
  OUTCOME_STATUSES,
  PLACEMENTS_APPROVE,
  PLACEMENTS_CREATE,
  PLACEMENTS_UPDATE,
  PLACEMENTS_VIEW,
  POSITION_TYPES,
  ROUND_RESULT_STATUSES,
  ROUND_STATUSES,
  ROUND_TYPES,
  Badge,
  fmtDate,
  inputStyle,
  labelStyle,
  lpa,
  loadError,
  selectStyle,
  tdStyle,
  thStyle,
  usePlacementsLookups,
} from './placements-shared';
import type { PlacementLookupsDto } from './placements-shared';

const TAKE = 50;

interface Can {
  view: boolean;
  create: boolean;
  update: boolean;
  approve: boolean;
}

interface EligibleStudentRow {
  id: string;
  admissionNumber: string | null;
  fullName: string | null;
  programId: string | null;
  eligibilityStatus: string;
}

type ApplicationRow = PlacementApplicationDto & {
  drive?: { id: string; title: string; code: string; status: string } | null;
  position?:
    | (PlacementPositionDto & { drive?: { company: { name: string } | null } | null })
    | null;
  resume?: { id: string; title: string; isPrimary: boolean } | null;
  selection?: { id: string; selectedAt: string } | null;
  offer?: { id: string; offerLetterNumber: string; status: string } | null;
};

type OfferRow = PlacementOfferDto & {
  drive?: { id: string; title: string; code: string; company: { name: string } | null } | null;
};

type ResultRow = PlacementRoundResultDto & {
  application?:
    | {
        id: string;
        student?: { id: string; admissionNumber: string | null; fullName: string | null } | null;
        position?: { id: string; title: string } | null;
      }
    | null;
};

function v(s: string | undefined): string | undefined {
  return s === undefined || s.trim() === '' ? undefined : s.trim();
}
function num(s: string | undefined): number | undefined {
  return s === undefined || s === '' ? undefined : Number(s);
}
/** Loads the tenant's drives once per mount — shared by the drive pickers in the apply form,
 * rounds manager and reports (the lookups endpoint deliberately omits drives). */
function useDrives(): PlacementDriveDto[] {
  const [drives, setDrives] = useState<PlacementDriveDto[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: PlacementDriveDto[]; total: number }>('/placements/drives?skip=0&take=200')
      .then((res) => {
        if (mounted) setDrives(res.data);
      })
      .catch(() => {
        if (mounted) setDrives([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return drives;
}

export function PlacementsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'overview' | 'companies' | 'drives' | 'applications' | 'offers' | 'reports'>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const lookups = usePlacementsLookups();

  const can: Can = {
    view: permissions.includes(PLACEMENTS_VIEW),
    create: permissions.includes(PLACEMENTS_CREATE),
    update: permissions.includes(PLACEMENTS_UPDATE),
    approve: permissions.includes(PLACEMENTS_APPROVE),
  };

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Placements</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('overview')}>Overview</Button>
          <Button variant="secondary" onClick={() => setTab('companies')}>Companies</Button>
          <Button variant="secondary" onClick={() => setTab('drives')}>Drives</Button>
          <Button variant="secondary" onClick={() => setTab('applications')}>Applications</Button>
          <Button variant="secondary" onClick={() => setTab('offers')}>Offers &amp; Joinings</Button>
          <Button variant="secondary" onClick={() => setTab('reports')}>Outcomes &amp; Reports</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'overview' && <OverviewTab lookups={lookups} reload={reload} onError={setError} />}
      {tab === 'companies' && (
        <CompaniesTab
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'drives' && (
        <DrivesTab
          lookups={lookups}
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'applications' && (
        <ApplicationsTab
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'offers' && (
        <OffersTab
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'reports' && (
        <ReportsTab
          lookups={lookups}
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ lookups, reload, onError }: { lookups: PlacementLookupsDto | null; reload: number; onError: (msg: string) => void }) {
  const [academicYearId, setAcademicYearId] = useState('');
  const [data, setData] = useState<PlacementStatisticsDto | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = academicYearId ? `?academicYearId=${academicYearId}` : '';
      setData(await apiFetch<PlacementStatisticsDto>(`/placements/statistics${q}`));
    } catch (e) {
      onError(loadError(e, 'Failed to load placement statistics'));
    } finally {
      setLoading(false);
    }
  }, [academicYearId, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ ...labelStyle, width: 220 }}>
          <label>Academic year</label>
          <select style={selectStyle} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
            <option value="">All years</option>
            {lookups?.academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {loading && !data ? (
        <p>Loading…</p>
      ) : !data ? (
        <p>No data.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {[
              ['Companies', data.totalCompanies],
              ['Drives', data.totalDrives],
              ['Positions', data.totalPositions],
              ['Applications', data.totalApplications],
              ['Shortlisted', data.shortlistedCandidates],
              ['Selected', data.selectedCandidates],
              ['Offers issued', data.offersIssued],
              ['Offers accepted', data.offersAccepted],
              ['Joined', data.joined],
              ['Placed', data.placedStudents],
              ['Eligible', data.eligibleStudents],
            ].map(([label, value]) => (
              <Card key={label}>
                <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{label}</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{value}</p>
              </Card>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            <Card>
              <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Package range</h3>
              <p>Average: {lpa(data.averagePackageCents)}</p>
              <p>Highest: {lpa(data.highestPackageCents)}</p>
              <p>Lowest: {lpa(data.lowestPackageCents)}</p>
            </Card>
            <Card>
              <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Drives by status</h3>
              {Object.entries(data.drivesByStatus).length === 0 ? (
                <p style={{ color: '#9ca3af' }}>No drives.</p>
              ) : (
                Object.entries(data.drivesByStatus).map(([status, count]) => (
                  <li key={status} style={{ listStyle: 'none' }}>
                    <Badge value={status} /> <b>{count}</b>
                  </li>
                ))
              )}
            </Card>
          </div>

          {data.departmentAnalytics.length > 0 && (
            <Card>
              <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Department analytics</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Department / Program</th>
                    <th style={thStyle}>Students</th>
                    <th style={thStyle}>Placed</th>
                    <th style={thStyle}>Rate</th>
                    <th style={thStyle}>Avg</th>
                    <th style={thStyle}>Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departmentAnalytics.map((d) => (
                    <tr key={`${d.departmentId}-${d.programId ?? ''}`}>
                      <td style={tdStyle}>{d.departmentName}{d.programName ? ` — ${d.programName}` : ''}</td>
                      <td style={tdStyle}>{d.totalStudents}</td>
                      <td style={tdStyle}>{d.placed}</td>
                      <td style={tdStyle}>{d.placementRate ?? '—'}%</td>
                      <td style={tdStyle}>{lpa(d.averagePackageCents)}</td>
                      <td style={tdStyle}>{lpa(d.highestPackageCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Companies & contacts ────────────────────────────────────────────────────

function CompaniesTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Can;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<PlacementCompanyDto[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [contactsFor, setContactsFor] = useState<PlacementCompanyDto | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (search) params.set('search', search);
      if (companyType) params.set('companyType', companyType);
      if (includeArchived) params.set('includeArchived', 'true');
      const res = await apiFetch<{ data: PlacementCompanyDto[]; total: number }>(`/placements/companies?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      onError(loadError(e, 'Failed to load companies'));
    } finally {
      setLoading(false);
    }
  }, [search, companyType, includeArchived, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 220 }}><label style={labelStyle}>Search</label>
          <input style={inputStyle} value={search} placeholder="Name / code" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ width: 180 }}>
          <label style={labelStyle}>Type</label>
          <select style={selectStyle} value={companyType} onChange={(e) => setCompanyType(e.target.value)}>
            <option value="">All</option>
            {COMPANY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
        <Button variant="secondary" onClick={load}>Search</Button>
        {can.create && <Button onClick={() => setShowCreate(true)}>Add company</Button>}
      </div>

      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{total} company/companies.</p>

      {showCreate && (
        <CreateCompanyForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            onNotice('Company created.');
            onReload();
          }}
          onError={onError}
        />
      )}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Industry</th>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.code}</td>
                  <td style={tdStyle}>{r.name} {r.isActive ? '' : <Badge value="Inactive" />}</td>
                  <td style={tdStyle}><Badge value={r.companyType} /></td>
                  <td style={tdStyle}>{r.industry ?? '—'}</td>
                  <td style={tdStyle}>{[r.headquartersCity, r.city, r.state, r.country].filter(Boolean).join(', ') || '—'}</td>
                  <td style={tdStyle}>
                    <Button variant="secondary" onClick={() => setContactsFor(r)}>Contacts</Button>
                    {can.update && !r.isActive && (
                      <Button
                        variant="secondary"
                        style={{ marginLeft: 6 }}
                        onClick={async () => {
                          try {
                            await apiFetch(`/placements/companies/${r.id}/restore`, { method: 'POST' });
                            onNotice('Company restored.');
                            onReload();
                          } catch (e) {
                            onError(loadError(e, 'Failed to restore company'));
                          }
                        }}
                      >
                        Restore
                      </Button>
                    )}
                    {can.update && r.isActive && (
                      <Button
                        variant="secondary"
                        style={{ marginLeft: 6 }}
                        onClick={async () => {
                          try {
                            await apiFetch(`/placements/companies/${r.id}`, { method: 'DELETE' });
                            onNotice('Company archived.');
                            onReload();
                          } catch (e) {
                            onError(loadError(e, 'Failed to archive company'));
                          }
                        }}
                      >
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {contactsFor && (
        <ContactsManager
          company={contactsFor}
          can={can}
          onClose={() => setContactsFor(null)}
          onError={onError}
        />
      )}
    </div>
  );
}

function CreateCompanyForm({ onClose, onCreated, onError }: { onClose: () => void; onCreated: () => void; onError: (msg: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    try {
      await apiFetch('/placements/companies', {
        method: 'POST',
        body: JSON.stringify({
          code: f.code,
          name: f.name,
          companyType: f.companyType,
          industry: v(f.industry),
          website: v(f.website),
          description: v(f.description),
          headquartersCity: v(f.headquartersCity),
          addressLine1: v(f.addressLine1),
          city: v(f.city),
          state: v(f.state),
          country: v(f.country),
          isActive,
        }),
      });
      onCreated();
    } catch (e) {
      onError(loadError(e, 'Failed to create company'));
    }
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>New company</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        <div><label style={labelStyle}>Code *<input style={inputStyle} value={f.code ?? ''} onChange={set('code')} /></label></div>
        <div><label style={labelStyle}>Name *<input style={inputStyle} value={f.name ?? ''} onChange={set('name')} /></label></div>
        <div>
          <label style={labelStyle}>Type
            <select style={selectStyle} value={f.companyType ?? ''} onChange={set('companyType')}>
              <option value="">OTHER</option>
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <div><label style={labelStyle}>Industry<input style={inputStyle} value={f.industry ?? ''} onChange={set('industry')} /></label></div>
        <div><label style={labelStyle}>Website<input style={inputStyle} value={f.website ?? ''} onChange={set('website')} /></label></div>
        <div><label style={labelStyle}>Headquarters city<input style={inputStyle} value={f.headquartersCity ?? ''} onChange={set('headquartersCity')} /></label></div>
        <div><label style={labelStyle}>City<input style={inputStyle} value={f.city ?? ''} onChange={set('city')} /></label></div>
        <div><label style={labelStyle}>State<input style={inputStyle} value={f.state ?? ''} onChange={set('state')} /></label></div>
        <div><label style={labelStyle}>Country<input style={inputStyle} value={f.country ?? ''} onChange={set('country')} /></label></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button onClick={submit} disabled={!v(f.code) || !v(f.name)}>Create</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

function ContactsManager({ company, can, onClose, onError }: { company: PlacementCompanyDto; can: Can; onClose: () => void; onError: (msg: string) => void }) {
  const [rows, setRows] = useState<PlacementContactDto[]>([]);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: PlacementContactDto[]; total: number }>(`/placements/contacts?companyId=${company.id}&includeArchived=true&take=${TAKE}`);
      setRows(res.data);
    } catch (e) {
      onError(loadError(e, 'Failed to load contacts'));
    }
  }, [company.id, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const addContact = async () => {
    try {
      await apiFetch('/placements/contacts', {
        method: 'POST',
        body: JSON.stringify({
          companyId: company.id,
          fullName: f.fullName,
          designation: v(f.designation),
          email: v(f.email),
          phone: v(f.phone),
          isPrimary: Boolean(f.isPrimary),
          isActive: true,
        }),
      });
      setF({});
      load();
    } catch (e) {
      onError(loadError(e, 'Failed to add contact'));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>{company.name} — Contacts</h3>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>

      {can.create && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, margin: '8px 0' }}>
          <div><label style={labelStyle}>Full name *<input style={inputStyle} value={f.fullName ?? ''} onChange={set('fullName')} /></label></div>
          <div><label style={labelStyle}>Designation<input style={inputStyle} value={f.designation ?? ''} onChange={set('designation')} /></label></div>
          <div><label style={labelStyle}>Email<input style={inputStyle} value={f.email ?? ''} onChange={set('email')} /></label></div>
          <div><label style={labelStyle}>Phone<input style={inputStyle} value={f.phone ?? ''} onChange={set('phone')} /></label></div>
          <Button style={{ alignSelf: 'flex-end' }} onClick={addContact} disabled={!v(f.fullName)}>Add</Button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Designation</th>
            <th style={thStyle}>Email</th>
            <th style={thStyle}>Phone</th>
            <th style={thStyle}>Primary</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={tdStyle}>{c.fullName} {c.isActive ? '' : <Badge value="Inactive" />}</td>
              <td style={tdStyle}>{c.designation ?? '—'}</td>
              <td style={tdStyle}>{c.email ?? '—'}</td>
              <td style={tdStyle}>{c.phone ?? '—'}</td>
              <td style={tdStyle}>{c.isPrimary ? '★' : ''}</td>
              <td style={tdStyle}>
                {can.update && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await apiFetch(`/placements/contacts/${c.id}`, { method: 'DELETE' });
                        load();
                      } catch (e) {
                        onError(loadError(e, 'Failed to remove contact'));
                      }
                    }}
                  >
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Drives & positions ──────────────────────────────────────────────────────

function DrivesTab({
  lookups,
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  lookups: PlacementLookupsDto | null;
  can: Can;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<PlacementDriveDto[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (search) params.set('search', search);
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      if (includeArchived) params.set('includeArchived', 'true');
      const res = await apiFetch<{ data: PlacementDriveDto[]; total: number }>(`/placements/drives?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      onError(loadError(e, 'Failed to load drives'));
    } finally {
      setLoading(false);
    }
  }, [search, companyId, status, includeArchived, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 200 }}><label style={labelStyle}>Search</label>
          <input style={inputStyle} value={search} placeholder="Title / code" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ width: 200 }}>
          <label style={labelStyle}>Company</label>
          <select style={selectStyle} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All</option>
            {lookups?.companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Status</label>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {DRIVE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
        <Button variant="secondary" onClick={load}>Search</Button>
        {can.create && <Button onClick={() => setShowCreate(true)}>Add drive</Button>}
      </div>

      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{total} drive(s).</p>

      {showCreate && (
        <CreateDriveForm
          lookups={lookups}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            onNotice('Drive created.');
            onReload();
          }}
          onError={onError}
        />
      )}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Company</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Deadline</th>
                <th style={thStyle}>Positions</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td style={tdStyle}>{r.code}</td>
                    <td style={tdStyle}>{r.title}</td>
                    <td style={tdStyle}>{r.company?.name ?? '—'}</td>
                    <td style={tdStyle}><Badge value={r.mode} /></td>
                    <td style={tdStyle}><Badge value={r.status} /></td>
                    <td style={tdStyle}>{fmtDate(r.driveDate)}</td>
                    <td style={tdStyle}>{fmtDate(r.applicationDeadline)}</td>
                    <td style={tdStyle}>{r._count?.positions ?? r.positions.length}</td>
                    <td style={tdStyle}>
                      <Button variant="secondary" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? 'Close' : 'Manage'}
                      </Button>
                      {can.update && r.status === 'DRAFT' && (
                        <Button
                          variant="secondary"
                          style={{ marginLeft: 6 }}
                          onClick={async () => {
                            try {
                              await apiFetch(`/placements/drives/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SCHEDULED' }) });
                              onNotice('Drive scheduled.');
                              onReload();
                            } catch (e) {
                              onError(loadError(e, 'Failed to schedule drive'));
                            }
                          }}
                        >
                          Schedule
                        </Button>
                      )}
                      {can.update && !r.status.match(/COMPLETED|CANCELLED/) && (
                        <Button
                          variant="secondary"
                          style={{ marginLeft: 6 }}
                          onClick={async () => {
                            try {
                              await apiFetch(`/placements/drives/${r.id}`, { method: 'DELETE' });
                              onNotice('Drive archived.');
                              onReload();
                            } catch (e) {
                              onError(loadError(e, 'Failed to archive drive'));
                            }
                          }}
                        >
                          Archive
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td style={{ ...tdStyle, background: '#f9fafb' }} colSpan={9}>
                        <DriveDetailPanel drive={r} can={can} onError={onError} onNotice={onNotice} onChanged={onReload} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function CreateDriveForm({
  lookups,
  onClose,
  onCreated,
  onError,
}: {
  lookups: PlacementLookupsDto | null;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    try {
      await apiFetch('/placements/drives', {
        method: 'POST',
        body: JSON.stringify({
          companyId: f.companyId,
          code: f.code,
          title: f.title,
          description: v(f.description),
          mode: f.mode,
          status: v(f.status),
          driveDate: v(f.driveDate),
          applicationDeadline: v(f.applicationDeadline),
          venue: v(f.venue),
          coordinatorContactId: v(f.coordinatorContactId),
          eligibilityNotes: v(f.eligibilityNotes),
        }),
      });
      onCreated();
    } catch (e) {
      onError(loadError(e, 'Failed to create drive'));
    }
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>New drive</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        <div>
          <label style={labelStyle}>Company *
            <select style={selectStyle} value={f.companyId ?? ''} onChange={set('companyId')}>
              <option value="">Select…</option>
              {lookups?.companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div><label style={labelStyle}>Code *<input style={inputStyle} value={f.code ?? ''} onChange={set('code')} /></label></div>
        <div><label style={labelStyle}>Title *<input style={inputStyle} value={f.title ?? ''} onChange={set('title')} /></label></div>
        <div>
          <label style={labelStyle}>Mode
            <select style={selectStyle} value={f.mode ?? ''} onChange={set('mode')}>
              <option value="">ON_CAMPUS</option>
              {DRIVE_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <label style={labelStyle}>Status
            <select style={selectStyle} value={f.status ?? ''} onChange={set('status')}>
              <option value="">DRAFT</option>
              {DRIVE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div><label style={labelStyle}>Drive date<input type="date" style={inputStyle} value={f.driveDate ?? ''} onChange={set('driveDate')} /></label></div>
        <div><label style={labelStyle}>Application deadline<input type="date" style={inputStyle} value={f.applicationDeadline ?? ''} onChange={set('applicationDeadline')} /></label></div>
        <div><label style={labelStyle}>Venue<input style={inputStyle} value={f.venue ?? ''} onChange={set('venue')} /></label></div>
        <div>
          <label style={labelStyle}>Coordinator contact
            <select style={selectStyle} value={f.coordinatorContactId ?? ''} onChange={set('coordinatorContactId')}>
              <option value="">None</option>
              {lookups?.contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.fullName}</option>
              ))}
            </select>
          </label>
        </div>
        <div><label style={labelStyle}>Eligibility notes<input style={inputStyle} value={f.eligibilityNotes ?? ''} onChange={set('eligibilityNotes')} /></label></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button onClick={submit} disabled={!v(f.companyId) || !v(f.code) || !v(f.title)}>Create</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

function DriveDetailPanel({
  drive,
  can,
  onError,
  onNotice,
  onChanged,
}: {
  drive: PlacementDriveDto;
  can: Can;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const [showPosition, setShowPosition] = useState(false);
  const [pf, setPf] = useState<Record<string, string>>({});
  const [selectedEligibility, setSelectedEligibility] = useState<string | null>(null);
  const [eligibilityRows, setEligibilityRows] = useState<PlacementEligibilityDto[]>([]);
  const [eligibleStudents, setEligibleStudents] = useState<EligibleStudentRow[]>([]);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [exempted, setExempted] = useState(false);
  const [notice, setLocalNotice] = useState<string | null>(null);

  const positions = drive.positions ?? [];

  const loadEligibility = useCallback(
    async (positionId: string) => {
      setSelectedEligibility(positionId);
      try {
        const [elig, eligibles] = await Promise.all([
          apiFetch<{ data: PlacementEligibilityDto[]; total: number }>(`/placements/eligibility?positionId=${positionId}&take=${TAKE}`),
          apiFetch<EligibleStudentRow[]>(`/placements/eligibility/eligible-students?positionId=${positionId}`),
        ]);
        setEligibilityRows(elig.data);
        setEligibleStudents(eligibles);
      } catch (e) {
        onError(loadError(e, 'Failed to load eligibility'));
      }
    },
    [onError],
  );

  const evaluate = async (positionId: string) => {
    setEvaluating(positionId);
    try {
      await apiFetch('/placements/eligibility/evaluate', {
        method: 'POST',
        body: JSON.stringify({ positionId, studentIds: [], force, exempted }),
      });
      onNotice('Eligibility evaluated.');
      setLocalNotice('Evaluation queued — refresh eligibility below.');
      loadEligibility(positionId);
    } catch (e) {
      onError(loadError(e, 'Failed to evaluate eligibility'));
    } finally {
      setEvaluating(null);
    }
  };

  const createPosition = async () => {
    try {
      await apiFetch('/placements/positions', {
        method: 'POST',
        body: JSON.stringify({
          driveId: drive.id,
          title: pf.title,
          positionType: pf.positionType,
          location: v(pf.location),
          openings: num(pf.openings),
          description: v(pf.description),
          minCgpa: num(pf.minCgpa),
          minPercentage: num(pf.minPercentage),
          maxBacklogs: num(pf.maxBacklogs),
          packageCents: num(pf.packageCents),
          packageNotes: v(pf.packageNotes),
          isActive: true,
        }),
      });
      setPf({});
      setShowPosition(false);
      onNotice('Position created.');
      onChanged();
    } catch (e) {
      onError(loadError(e, 'Failed to create position'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h4 style={{ fontSize: '0.9rem', margin: 0 }}>Positions</h4>
        {can.update && <Button variant="secondary" onClick={() => setShowPosition((s) => !s)}>Add position</Button>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Force re-evaluate
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={exempted} onChange={(e) => setExempted(e.target.checked)} /> Mark all exempted
        </label>
      </div>

      {showPosition && (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            <div><label style={labelStyle}>Title *<input style={inputStyle} value={pf.title ?? ''} onChange={(e) => setPf((p) => ({ ...p, title: e.target.value }))} /></label></div>
            <div>
              <label style={labelStyle}>Type
                <select style={selectStyle} value={pf.positionType ?? ''} onChange={(e) => setPf((p) => ({ ...p, positionType: e.target.value }))}>
                  <option value="">FULL_TIME</option>
                  {POSITION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div><label style={labelStyle}>Location<input style={inputStyle} value={pf.location ?? ''} onChange={(e) => setPf((p) => ({ ...p, location: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Openings<input type="number" style={inputStyle} value={pf.openings ?? ''} onChange={(e) => setPf((p) => ({ ...p, openings: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Min CGPA<input type="number" step="0.01" style={inputStyle} value={pf.minCgpa ?? ''} onChange={(e) => setPf((p) => ({ ...p, minCgpa: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Min %<input type="number" step="0.01" style={inputStyle} value={pf.minPercentage ?? ''} onChange={(e) => setPf((p) => ({ ...p, minPercentage: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Max backlogs<input type="number" style={inputStyle} value={pf.maxBacklogs ?? ''} onChange={(e) => setPf((p) => ({ ...p, maxBacklogs: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Package (rupees)<input type="number" style={inputStyle} value={pf.packageCents ?? ''} onChange={(e) => setPf((p) => ({ ...p, packageCents: e.target.value }))} /></label></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button onClick={createPosition} disabled={!v(pf.title)}>Create</Button>
            <Button variant="secondary" onClick={() => setShowPosition(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {positions.length === 0 ? (
        <div>
          <p style={{ color: '#9ca3af' }}>No positions yet.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Openings</th>
              <th style={thStyle}>Package</th>
              <th style={thStyle}>Criteria</th>
              <th style={thStyle}>Apps</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id}>
                <td style={tdStyle}>{p.title} {p.isActive ? '' : <Badge value="Inactive" />}</td>
                <td style={tdStyle}><Badge value={p.positionType} /></td>
                <td style={tdStyle}>{p.openings ?? '—'}</td>
                <td style={tdStyle}>{lpa(p.packageCents)}</td>
                <td style={tdStyle}>{[p.minCgpa != null ? `CGPA ${p.minCgpa}` : '', p.minPercentage != null ? `% ${p.minPercentage}` : '', p.maxBacklogs != null ? `BL ${p.maxBacklogs}` : ''].filter(Boolean).join(', ') || '—'}</td>
                <td style={tdStyle}>{p._count?.applications ?? '—'}</td>
                <td style={tdStyle}>
                  {can.update && (
                    <Button variant="secondary" onClick={() => evaluate(p.id)} disabled={evaluating === p.id}>
                      {evaluating === p.id ? 'Evaluating…' : 'Evaluate'}
                    </Button>
                  )}
                  {can.update && (
                    <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => loadEligibility(p.id)}>
                      Eligibility
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {notice && <p style={{ color: '#15803d', fontSize: '0.85rem' }}>{notice}</p>}

      {selectedEligibility && (
        <Card>
          <h4 style={{ fontSize: '0.85rem', margin: 0 }}>Eligibility — {positions.find((p) => p.id === selectedEligibility)?.title}</h4>
          {eligibleStudents.length > 0 && (
            <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{eligibleStudents.length} eligible/exempted student(s) can apply now.</p>
          )}
          {eligibilityRows.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No evaluation records. Run Evaluate to score students.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Remarks</th>
                  <th style={thStyle}>Override</th>
                </tr>
              </thead>
              <tbody>
                {eligibilityRows.map((el) => (
                  <tr key={el.id}>
                    <td style={tdStyle}>{el.student?.fullName ?? el.studentId}</td>
                    <td style={tdStyle}><Badge value={el.status} /></td>
                    <td style={tdStyle}>{el.remarks ?? '—'}</td>
                    <td style={tdStyle}>
                      {can.update && (
                        <SelectOverride
                          record={el}
                          onDone={(msg) => {
                            onNotice(msg);
                            loadEligibility(selectedEligibility);
                          }}
                          onError={onError}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function SelectOverride({
  record,
  onDone,
  onError,
}: {
  record: PlacementEligibilityDto;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [remarks, setRemarks] = useState('');

  const apply = async () => {
    try {
      await apiFetch(`/placements/eligibility/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, remarks: v(remarks) }),
      });
      onDone(`Eligibility updated to ${status}.`);
    } catch (e) {
      onError(loadError(e, 'Failed to update eligibility'));
    }
  };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Set…</option>
        {ELIGIBILITY_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input style={{ ...inputStyle, width: 140 }} placeholder="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <Button variant="secondary" onClick={apply} disabled={!status}>Apply</Button>
    </div>
  );
}

// ── Applications, rounds & results ──────────────────────────────────────────

function ApplicationsTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Can;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [driveId, setDriveId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showApply, setShowApply] = useState(false);
  const [showRounds, setShowRounds] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE), includeAll: 'true' });
      if (driveId) params.set('driveId', driveId);
      if (status) params.set('status', status);
      const res = await apiFetch<{ data: ApplicationRow[]; total: number }>(`/placements/applications?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      onError(loadError(e, 'Failed to load applications'));
    } finally {
      setLoading(false);
    }
  }, [driveId, status, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  const updateStatus = async (id: string, next: string) => {
    try {
      await apiFetch(`/placements/applications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      onNotice(`Application ${next.toLowerCase()}.`);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to update application'));
    }
  };

  const createSelection = async (id: string) => {
    try {
      await apiFetch('/placements/selections', {
        method: 'POST',
        body: JSON.stringify({ applicationId: id }),
      });
      onNotice('Student selected.');
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to record selection'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 220 }}>
          <label style={labelStyle}>Drive</label>
          <select style={selectStyle} value={driveId} onChange={(e) => setDriveId(e.target.value)}>
            <option value="">All drives</option>
            {rows.map((r) => r.drive).filter((d, i, a) => d && a.findIndex((x) => x?.id === d.id) === i).map((d) => (
              <option key={d!.id} value={d!.id}>{d!.title}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Status</label>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={load}>Search</Button>
        {can.create && <Button onClick={() => setShowApply((s) => !s)}>Bulk apply</Button>}
        {can.update && <Button variant="secondary" onClick={() => setShowRounds((s) => !s)}>Rounds &amp; results</Button>}
      </div>

      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{total} application(s).</p>

      {showApply && (
        <BulkApplyForm driveId={driveId} onDone={onNotice} onError={onError} />
      )}

      {showRounds && <RoundsManager driveId={driveId} can={can} onError={onError} onNotice={onNotice} />}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Drive / Position</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Applied</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.student?.fullName ?? r.studentId}<br /><span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.student?.admissionNumber}</span></td>
                  <td style={tdStyle}>{r.drive?.title ?? '—'}<br /><span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.position?.title}</span></td>
                  <td style={tdStyle}><Badge value={r.status} /></td>
                  <td style={tdStyle}>{fmtDate(r.appliedAt)}</td>
                  <td style={tdStyle}>
                    {can.update && r.status === 'APPLIED' && (
                      <Button variant="secondary" onClick={() => updateStatus(r.id, 'SHORTLISTED')}>Shortlist</Button>
                    )}
                    {can.update && (r.status === 'APPLIED' || r.status === 'SHORTLISTED') && (
                      <>
                        <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => updateStatus(r.id, 'REJECTED')}>Reject</Button>
                        {r.status === 'SHORTLISTED' && (
                          <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => createSelection(r.id)}>Select</Button>
                        )}
                      </>
                    )}
                    {can.update && (r.status === 'APPLIED' || r.status === 'SHORTLISTED') && (
                      <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => updateStatus(r.id, 'WITHDRAWN')}>Withdraw</Button>
                    )}
                    {r.selection && <Badge value="Selected" />}
                    {r.offer && <Badge value={`Offer: ${r.offer.status}`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function BulkApplyForm({
  driveId,
  onDone,
  onError,
}: {
  driveId: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [positionId, setPositionId] = useState('');
  const [students, setStudents] = useState<EligibleStudentRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [positions, setPositions] = useState<PlacementPositionDto[]>([]);
  const drives = useDrives();
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [drive, setDrive] = useState(driveId);

  const loadPositions = useCallback(async () => {
    if (!drive) return;
    try {
      const res = await apiFetch<{ data: PlacementPositionDto[]; total: number }>(`/placements/positions?driveId=${drive}&take=200`);
      setPositions(res.data);
    } catch (e) {
      onError(loadError(e, 'Failed to load positions'));
    }
  }, [drive, onError]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const loadEligible = async () => {
    if (!positionId) return;
    setLoadingStudents(true);
    try {
      const list = await apiFetch<EligibleStudentRow[]>(`/placements/eligibility/eligible-students?positionId=${positionId}`);
      setStudents(list);
      setChecked(new Set(list.map((s) => s.id)));
    } catch (e) {
      onError(loadError(e, 'Failed to load eligible students'));
    } finally {
      setLoadingStudents(false);
    }
  };

  const submit = async () => {
    if (!drive || !positionId || checked.size === 0) return;
    try {
      await apiFetch('/placements/applications/bulk', {
        method: 'POST',
        body: JSON.stringify({ driveId: drive, positionId, studentIds: [...checked] }),
      });
      onDone(`Applied ${checked.size} student(s).`);
      setStudents([]);
      setChecked(new Set());
    } catch (e) {
      onError(loadError(e, 'Failed to create applications'));
    }
  };

  const toggle = (sid: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Bulk apply — drive → position → eligible students</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 220 }}>
          <label style={labelStyle}>Drive</label>
          <select style={selectStyle} value={drive} onChange={(e) => setDrive(e.target.value)}>
            <option value="">Select…</option>
            {drives.map((d) => (
              <option key={d.id} value={d.id}>{d.title} — {d.company?.name ?? '—'}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 220 }}>
          <label style={labelStyle}>Position</label>
          <select style={selectStyle} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">Select…</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>{p.title} — {lpa(p.packageCents)}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={loadEligible} disabled={!positionId}>
          {loadingStudents ? 'Loading…' : 'Load eligible students'}
        </Button>
      </div>

      {students.length > 0 && (
        <>
          <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{students.length} eligible/exempted student(s).</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 4, maxHeight: 260, overflow: 'auto' }}>
            {students.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                {s.fullName} <span style={{ color: '#9ca3af' }}>({s.admissionNumber})</span>
              </label>
            ))}
          </div>
          <Button onClick={submit} disabled={checked.size === 0} style={{ marginTop: 8 }}>
            Create applications ({checked.size})
          </Button>
        </>
      )}
    </Card>
  );
}

function RoundsManager({
  driveId,
  can,
  onError,
  onNotice,
}: {
  driveId: string;
  can: Can;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [drive, setDrive] = useState(driveId);
  const drives = useDrives();
  const [rounds, setRounds] = useState<PlacementRoundDto[]>([]);
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [rf, setRf] = useState<Record<string, string>>({});
  const [rrf, setRrf] = useState<Record<string, string>>({});

  const loadRounds = useCallback(async () => {
    if (!drive) return;
    try {
      setRounds(await apiFetch<PlacementRoundDto[]>(`/placements/rounds?driveId=${drive}`));
    } catch (e) {
      onError(loadError(e, 'Failed to load rounds'));
    }
  }, [drive, onError]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  useEffect(() => {
    if (!drive) return;
    apiFetch<{ data: ApplicationRow[]; total: number }>(`/placements/applications?driveId=${drive}&includeAll=true&take=200`)
      .then((res) => setApplications(res.data))
      .catch(() => undefined);
  }, [drive]);

  const loadResults = async (roundId: string) => {
    setSelectedRound(roundId);
    try {
      setResults(await apiFetch<ResultRow[]>(`/placements/round-results?roundId=${roundId}`));
    } catch (e) {
      onError(loadError(e, 'Failed to load round results'));
    }
  };

  const createRound = async () => {
    if (!drive) return;
    try {
      await apiFetch('/placements/rounds', {
        method: 'POST',
        body: JSON.stringify({
          driveId: drive,
          sequence: num(rf.sequence),
          roundType: rf.roundType,
          title: v(rf.title),
          scheduledAt: v(rf.scheduledAt),
          locationOrLink: v(rf.locationOrLink),
          status: v(rf.status),
          notes: v(rf.notes),
        }),
      });
      setRf({});
      onNotice('Round created.');
      loadRounds();
    } catch (e) {
      onError(loadError(e, 'Failed to create round'));
    }
  };

  const recordResult = async () => {
    if (!selectedRound || !rrf.applicationId) return;
    try {
      await apiFetch('/placements/round-results', {
        method: 'POST',
        body: JSON.stringify({
          roundId: selectedRound,
          applicationId: rrf.applicationId,
          result: rrf.result,
          score: num(rrf.score),
          feedback: v(rrf.feedback),
        }),
      });
      setRrf({});
      onNotice('Result recorded.');
      loadResults(selectedRound);
    } catch (e) {
      onError(loadError(e, 'Failed to record result'));
    }
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Rounds &amp; results</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 240 }}>
          <label style={labelStyle}>Drive</label>
          <select style={selectStyle} value={drive} onChange={(e) => setDrive(e.target.value)}>
            <option value="">Select…</option>
            {drives.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </div>
        {can.create && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 110 }}><label style={labelStyle}>Seq<input type="number" style={inputStyle} value={rf.sequence ?? ''} onChange={(e) => setRf((p) => ({ ...p, sequence: e.target.value }))} /></label></div>
            <div style={{ width: 150 }}>
              <label style={labelStyle}>Type
                <select style={selectStyle} value={rf.roundType ?? ''} onChange={(e) => setRf((p) => ({ ...p, roundType: e.target.value }))}>
                  <option value="">Select…</option>
                  {ROUND_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ width: 160 }}><label style={labelStyle}>Title<input style={inputStyle} value={rf.title ?? ''} onChange={(e) => setRf((p) => ({ ...p, title: e.target.value }))} /></label></div>
            <div style={{ width: 150 }}><label style={labelStyle}>Scheduled at<input type="date" style={inputStyle} value={rf.scheduledAt ?? ''} onChange={(e) => setRf((p) => ({ ...p, scheduledAt: e.target.value }))} /></label></div>
            <div style={{ width: 140 }}>
              <label style={labelStyle}>Status
                <select style={selectStyle} value={rf.status ?? ''} onChange={(e) => setRf((p) => ({ ...p, status: e.target.value }))}>
                  <option value="">SCHEDULED</option>
                  {ROUND_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <Button onClick={createRound} disabled={!drive || !rf.sequence || !rf.roundType}>Add round</Button>
          </div>
        )}
      </div>

      {rounds.length === 0 ? (
        <p style={{ color: '#9ca3af' }}>No rounds.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr>
              <th style={thStyle}>Seq</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Scheduled</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Results</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((rnd) => (
              <tr key={rnd.id}>
                <td style={tdStyle}>{rnd.sequence}</td>
                <td style={tdStyle}><Badge value={rnd.roundType} /></td>
                <td style={tdStyle}>{rnd.title ?? '—'}</td>
                <td style={tdStyle}>{fmtDate(rnd.scheduledAt)}</td>
                <td style={tdStyle}><Badge value={rnd.status} /></td>
                <td style={tdStyle}>{rnd._count?.results ?? 0}</td>
                <td style={tdStyle}>
                  {can.update && <Button variant="secondary" onClick={() => loadResults(rnd.id)}>Results</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedRound && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>Results — round {rounds.find((r) => r.id === selectedRound)?.sequence}</h4>
          {can.update && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ width: 220 }}>
                <label style={labelStyle}>Applicant
                  <select style={selectStyle} value={rrf.applicationId ?? ''} onChange={(e) => setRrf((p) => ({ ...p, applicationId: e.target.value }))}>
                    <option value="">Select…</option>
                    {applications.map((a) => (
                      <option key={a.id} value={a.id}>{a.student?.fullName ?? a.studentId} — {a.position?.title}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ width: 140 }}>
                <label style={labelStyle}>Result
                  <select style={selectStyle} value={rrf.result ?? ''} onChange={(e) => setRrf((p) => ({ ...p, result: e.target.value }))}>
                    <option value="">Select…</option>
                    {ROUND_RESULT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ width: 110 }}><label style={labelStyle}>Score<input style={inputStyle} value={rrf.score ?? ''} onChange={(e) => setRrf((p) => ({ ...p, score: e.target.value }))} /></label></div>
              <div style={{ width: 160 }}><label style={labelStyle}>Feedback<input style={inputStyle} value={rrf.feedback ?? ''} onChange={(e) => setRrf((p) => ({ ...p, feedback: e.target.value }))} /></label></div>
              <Button onClick={recordResult} disabled={!rrf.applicationId || !rrf.result}>Record</Button>
            </div>
          )}
          {results.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No results yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Position</th>
                  <th style={thStyle}>Result</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Feedback</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.application?.student?.fullName ?? row.applicationId}</td>
                    <td style={tdStyle}>{row.application?.position?.title ?? '—'}</td>
                    <td style={tdStyle}><Badge value={row.result} /></td>
                    <td style={tdStyle}>{row.score ?? '—'}</td>
                    <td style={tdStyle}>{row.feedback ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Offers & joinings ───────────────────────────────────────────────────────

function OffersTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Can;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [driveId, setDriveId] = useState('');
  const [status, setStatus] = useState('');
  const [showOffer, setShowOffer] = useState(false);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [of, setOf] = useState<Record<string, string>>({});
  const [joinings, setJoinings] = useState<PlacementJoiningDto[]>([]);
  const [jf, setJf] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (driveId) params.set('driveId', driveId);
      if (status) params.set('status', status);
      const [offers, joins] = await Promise.all([
        apiFetch<{ data: OfferRow[]; total: number }>(`/placements/offers?${params.toString()}`),
        apiFetch<{ data: PlacementJoiningDto[]; total: number }>(`/placements/joinings${driveId ? `?driveId=${driveId}` : ''}&take=${TAKE}`),
      ]);
      setRows(offers.data);
      setTotal(offers.total);
      setJoinings(joins.data);
    } catch (e) {
      onError(loadError(e, 'Failed to load offers/joinings'));
    } finally {
      setLoading(false);
    }
  }, [driveId, status, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  useEffect(() => {
    if (!driveId) return;
    apiFetch<{ data: ApplicationRow[]; total: number }>(`/placements/applications?driveId=${driveId}&includeAll=true&take=200`)
      .then((res) => setApplications(res.data))
      .catch(() => undefined);
  }, [driveId]);

  const issueOffer = async () => {
    try {
      await apiFetch('/placements/offers', {
        method: 'POST',
        body: JSON.stringify({
          applicationId: of.applicationId,
          offerLetterNumber: of.offerLetterNumber,
          packageCents: num(of.packageCents),
          joiningLocation: v(of.joiningLocation),
          expiryDate: v(of.expiryDate),
          notes: v(of.notes),
        }),
      });
      setShowOffer(false);
      setOf({});
      onNotice('Offer issued.');
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to issue offer'));
    }
  };

  const decide = async (id: string, decision: string) => {
    try {
      await apiFetch(`/placements/offers/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      onNotice(`Offer ${decision.toLowerCase()}.`);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to update offer'));
    }
  };

  const createJoining = async () => {
    try {
      await apiFetch('/placements/joinings', {
        method: 'POST',
        body: JSON.stringify({
          offerId: jf.offerId,
          expectedJoiningDate: v(jf.expectedJoiningDate),
          actualJoiningDate: v(jf.actualJoiningDate),
          joiningLocation: v(jf.joiningLocation),
          status: jf.status,
          remarks: v(jf.remarks),
        }),
      });
      setJf({});
      onNotice('Joining record created.');
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to create joining record'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 200 }}>
          <label style={labelStyle}>Drive</label>
          <select style={selectStyle} value={driveId} onChange={(e) => setDriveId(e.target.value)}>
            <option value="">All</option>
            {rows.map((r) => r.drive).filter((d, i, a) => d && a.findIndex((x) => x?.id === d.id) === i).map((d) => (
              <option key={d!.id} value={d!.id}>{d!.title}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Status</label>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {OFFER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={load}>Search</Button>
        {can.create && <Button onClick={() => setShowOffer(true)}>Issue offer</Button>}
      </div>

      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{total} offer(s).</p>

      {showOffer && (
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Issue offer</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            <div>
              <label style={labelStyle}>Application *
                <select style={selectStyle} value={of.applicationId ?? ''} onChange={(e) => setOf((p) => ({ ...p, applicationId: e.target.value }))}>
                  <option value="">Select…</option>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>{a.student?.fullName ?? a.studentId} — {a.position?.title} ({a.status})</option>
                  ))}
                </select>
              </label>
            </div>
            <div><label style={labelStyle}>Offer letter no. *<input style={inputStyle} value={of.offerLetterNumber ?? ''} onChange={(e) => setOf((p) => ({ ...p, offerLetterNumber: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Package (rupees)<input type="number" style={inputStyle} value={of.packageCents ?? ''} onChange={(e) => setOf((p) => ({ ...p, packageCents: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Joining location<input style={inputStyle} value={of.joiningLocation ?? ''} onChange={(e) => setOf((p) => ({ ...p, joiningLocation: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Expiry date<input type="date" style={inputStyle} value={of.expiryDate ?? ''} onChange={(e) => setOf((p) => ({ ...p, expiryDate: e.target.value }))} /></label></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button onClick={issueOffer} disabled={!of.applicationId || !v(of.offerLetterNumber)}>Issue</Button>
            <Button variant="secondary" onClick={() => setShowOffer(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Company / Position</th>
                <th style={thStyle}>Offer no.</th>
                <th style={thStyle}>Package</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Issued</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.student?.fullName ?? r.studentId}</td>
                  <td style={tdStyle}>{r.drive?.company?.name ?? '—'}<br /><span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.position?.title}</span></td>
                  <td style={tdStyle}>{r.offerLetterNumber}</td>
                  <td style={tdStyle}>{lpa(r.packageCents)}</td>
                  <td style={tdStyle}><Badge value={r.status} /></td>
                  <td style={tdStyle}>{fmtDate(r.issuedAt)}</td>
                  <td style={tdStyle}>
                    {can.update && r.status === 'ISSUED' && (
                      <>
                        <Button variant="secondary" onClick={() => decide(r.id, 'ACCEPTED')}>Accept</Button>
                        <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => decide(r.id, 'DECLINED')}>Decline</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Joining records</h3>
        {can.create && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
            <div style={{ width: 240 }}>
              <label style={labelStyle}>Offer
                <select style={selectStyle} value={jf.offerId ?? ''} onChange={(e) => setJf((p) => ({ ...p, offerId: e.target.value }))}>
                  <option value="">Select…</option>
                  {rows.filter((r) => r.status === 'ACCEPTED').map((r) => (
                    <option key={r.id} value={r.id}>{r.offerLetterNumber} — {r.student?.fullName}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ width: 150 }}><label style={labelStyle}>Expected<input type="date" style={inputStyle} value={jf.expectedJoiningDate ?? ''} onChange={(e) => setJf((p) => ({ ...p, expectedJoiningDate: e.target.value }))} /></label></div>
            <div style={{ width: 150 }}><label style={labelStyle}>Actual<input type="date" style={inputStyle} value={jf.actualJoiningDate ?? ''} onChange={(e) => setJf((p) => ({ ...p, actualJoiningDate: e.target.value }))} /></label></div>
            <div style={{ width: 160 }}><label style={labelStyle}>Location<input style={inputStyle} value={jf.joiningLocation ?? ''} onChange={(e) => setJf((p) => ({ ...p, joiningLocation: e.target.value }))} /></label></div>
            <div style={{ width: 150 }}>
              <label style={labelStyle}>Status
                <select style={selectStyle} value={jf.status ?? ''} onChange={(e) => setJf((p) => ({ ...p, status: e.target.value }))}>
                  <option value="">PENDING</option>
                  {JOINING_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <Button onClick={createJoining} disabled={!jf.offerId}>Add</Button>
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Student</th>
              <th style={thStyle}>Offer</th>
              <th style={thStyle}>Expected</th>
              <th style={thStyle}>Actual</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {joinings.length === 0 && <tr><td style={tdStyle} colSpan={7}>No joining records.</td></tr>}
            {joinings.map((j) => (
              <tr key={j.id}>
                <td style={tdStyle}>{j.student?.fullName ?? j.offer?.offerLetterNumber ?? '—'}</td>
                <td style={tdStyle}>{j.offer?.offerLetterNumber ?? '—'}</td>
                <td style={tdStyle}>{fmtDate(j.expectedJoiningDate)}</td>
                <td style={tdStyle}>{fmtDate(j.actualJoiningDate)}</td>
                <td style={tdStyle}>{j.joiningLocation ?? '—'}</td>
                <td style={tdStyle}><Badge value={j.status} /></td>
                <td style={tdStyle}>
                  {can.update && (
                    <JoinStatusSelect
                      id={j.id}
                      current={j.status}
                      onDone={(msg) => {
                        onNotice(msg);
                        onReload();
                      }}
                      onError={onError}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function JoinStatusSelect({ id, current, onDone, onError }: { id: string; current: string; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [value, setValue] = useState('');
  const apply = async () => {
    try {
      await apiFetch(`/placements/joinings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: value }),
      });
      onDone(`Joining status → ${value}.`);
    } catch (e) {
      onError(loadError(e, 'Failed to update joining'));
    }
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{current}</span>
      <select style={selectStyle} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Set…</option>
        {JOINING_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Button variant="secondary" onClick={apply} disabled={!value}>Update</Button>
    </div>
  );
}

// ── Outcomes & reports ──────────────────────────────────────────────────────

function ReportsTab({
  lookups,
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  lookups: PlacementLookupsDto | null;
  can: Can;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [academicYearId, setAcademicYearId] = useState('');
  const [outcomeStatus, setOutcomeStatus] = useState('');
  const [rows, setRows] = useState<PlacementOutcomeDto[]>([]);
  const [report, setReport] = useState<PlacementReportDto | null>(null);
  const [drivesByYear, setDrivesByYear] = useState<PlacementDriveDto[]>([]);
  const [showDeclare, setShowDeclare] = useState(false);
  const [of, setOf] = useState<Record<string, string>>({});
  const [candidateOptions, setCandidateOptions] = useState<EligibleStudentRow[]>([]);
  const [positions, setPositions] = useState<PlacementPositionDto[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (academicYearId) params.set('academicYearId', academicYearId);
      if (outcomeStatus) params.set('outcomeStatus', outcomeStatus);
      const [list, rep] = await Promise.all([
        apiFetch<{ data: PlacementOutcomeDto[]; total: number }>(`/placements/outcomes?${params.toString()}`),
        apiFetch<PlacementReportDto>(`/placements/reports${academicYearId ? `?academicYearId=${academicYearId}` : ''}`),
      ]);
      setRows(list.data);
      setReport(rep);
    } catch (e) {
      onError(loadError(e, 'Failed to load outcomes/report'));
    } finally {
      setLoading(false);
    }
  }, [academicYearId, outcomeStatus, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  useEffect(() => {
    if (!academicYearId) return;
    apiFetch<{ data: PlacementDriveDto[]; total: number }>(`/placements/drives?skip=0&take=${TAKE}`)
      .then((res) => setDrivesByYear(res.data))
      .catch(() => undefined);
  }, [academicYearId, reload]);

  useEffect(() => {
    if (!of.driveId) {
      setPositions([]);
      return;
    }
    let mounted = true;
    apiFetch<{ data: PlacementPositionDto[]; total: number }>(`/placements/positions?driveId=${of.driveId}&take=200`)
      .then((res) => {
        if (mounted) setPositions(res.data);
      })
      .catch(() => {
        if (mounted) setPositions([]);
      });
    return () => {
      mounted = false;
    };
  }, [of.driveId]);

  const loadCandidates = async () => {
    if (!of.positionId) return;
    try {
      setCandidateOptions(await apiFetch<EligibleStudentRow[]>(`/placements/eligibility/eligible-students?positionId=${of.positionId}`));
    } catch (e) {
      onError(loadError(e, 'Failed to load candidates'));
    }
  };

  const declare = async () => {
    try {
      await apiFetch('/placements/outcomes', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: of.academicYearId,
          studentId: of.studentId,
          outcomeStatus: of.outcomeStatus,
          driveId: v(of.driveId),
          positionId: v(of.positionId),
          offerId: v(of.offerId),
          finalPackageCents: num(of.finalPackageCents),
          placedAt: v(of.placedAt),
          remarks: v(of.remarks),
        }),
      });
      setShowDeclare(false);
      setOf({});
      onNotice('Outcome declared.');
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to declare outcome'));
    }
  };

  const summarize = (r: PlacementReportDto | null) => {
    if (!r) return [];
    return [
      ['Total eligible', r.totalEligible],
      ['Applied', r.totalApplied],
      ['Shortlisted', r.totalShortlisted],
      ['Selected', r.totalSelected],
      ['Offers', r.totalOffers],
      ['Accepted', r.offersAccepted],
      ['Joined', r.joined],
      ['Placed', r.placed],
    ];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 220 }}>
          <label style={labelStyle}>Academic year</label>
          <select style={selectStyle} value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
            <option value="">All years</option>
            {lookups?.academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Outcome</label>
          <select style={selectStyle} value={outcomeStatus} onChange={(e) => setOutcomeStatus(e.target.value)}>
            <option value="">All</option>
            {OUTCOME_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
        {can.approve && <Button onClick={() => setShowDeclare(true)}>Declare outcome</Button>}
      </div>

      {report && (
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Placement report</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
            {summarize(report).map(([label, value]) => (
              <div key={String(label)}>
                <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{label}</p>
                <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>{value}</p>
              </div>
            ))}
          </div>
          {report.departmentAnalytics.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}>Students</th>
                  <th style={thStyle}>Placed</th>
                  <th style={thStyle}>Rate</th>
                  <th style={thStyle}>Avg package</th>
                </tr>
              </thead>
              <tbody>
                {report.departmentAnalytics.map((d) => (
                  <tr key={`${d.departmentId}-${d.programId ?? ''}`}>
                    <td style={tdStyle}>{d.departmentName}{d.programName ? ` — ${d.programName}` : ''}</td>
                    <td style={tdStyle}>{d.totalStudents}</td>
                    <td style={tdStyle}>{d.placed}</td>
                    <td style={tdStyle}>{d.placementRate ?? '—'}%</td>
                    <td style={tdStyle}>{lpa(d.averagePackageCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {showDeclare && (
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Declare outcome</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            <div>
              <label style={labelStyle}>Academic year *
                <select style={selectStyle} value={of.academicYearId ?? ''} onChange={(e) => setOf((p) => ({ ...p, academicYearId: e.target.value }))}>
                  <option value="">Select…</option>
                  {lookups?.academicYears.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label style={labelStyle}>Status *
                <select style={selectStyle} value={of.outcomeStatus ?? ''} onChange={(e) => setOf((p) => ({ ...p, outcomeStatus: e.target.value }))}>
                  <option value="">Select…</option>
                  {OUTCOME_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label style={labelStyle}>Drive</label>
              <select style={selectStyle} value={of.driveId ?? ''} onChange={(e) => setOf((p) => ({ ...p, driveId: e.target.value }))}>
                <option value="">None</option>
                {drivesByYear.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </div>
            {of.driveId && (
              <div>
                <label style={labelStyle}>Position (for candidates)</label>
                <select
                  style={selectStyle}
                  value={of.positionId ?? ''}
                  onChange={(e) => {
                    setOf((p) => ({ ...p, positionId: e.target.value }));
                    setCandidateOptions([]);
                  }}
                >
                  <option value="">Select…</option>
                  {positions.filter((p) => p.driveId === of.driveId).map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
            )}
            {of.positionId && (
              <>
                <div>
                  <label style={labelStyle}>Student *
                    <select style={selectStyle} value={of.studentId ?? ''} onChange={(e) => setOf((p) => ({ ...p, studentId: e.target.value }))}>
                      <option value="">Select…</option>
                      {candidateOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button variant="secondary" style={{ alignSelf: 'flex-end' }} onClick={loadCandidates} disabled={!of.positionId}>
                  Load candidates
                </Button>
              </>
            )}
            <div><label style={labelStyle}>Final package (rupees)<input type="number" style={inputStyle} value={of.finalPackageCents ?? ''} onChange={(e) => setOf((p) => ({ ...p, finalPackageCents: e.target.value }))} /></label></div>
            <div><label style={labelStyle}>Placed at<input type="date" style={inputStyle} value={of.placedAt ?? ''} onChange={(e) => setOf((p) => ({ ...p, placedAt: e.target.value }))} /></label></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button onClick={declare} disabled={!of.academicYearId || !of.outcomeStatus || !of.studentId}>Declare</Button>
            <Button variant="secondary" onClick={() => setShowDeclare(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Outcomes ({rows.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Package</th>
                <th style={thStyle}>Placed at</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td style={tdStyle} colSpan={6}>No outcomes.</td></tr>}
              {rows.map((o) => (
                <tr key={o.id}>
                  <td style={tdStyle}>{o.student?.fullName ?? o.studentId}</td>
                  <td style={tdStyle}>{o.academicYear?.name ?? '—'}</td>
                  <td style={tdStyle}><Badge value={o.outcomeStatus} /></td>
                  <td style={tdStyle}>{lpa(o.finalPackageCents)}</td>
                  <td style={tdStyle}>{fmtDate(o.placedAt)}</td>
                  <td style={tdStyle}>
                    {can.approve && (
                      <OutcomeUpdateSelect
                        id={o.id}
                        onDone={(msg) => {
                          onNotice(msg);
                          onReload();
                        }}
                        onError={onError}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function OutcomeUpdateSelect({ id, onDone, onError }: { id: string; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [value, setValue] = useState('');
  const apply = async () => {
    try {
      await apiFetch(`/placements/outcomes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ outcomeStatus: value }),
      });
      onDone(`Outcome → ${value}.`);
    } catch (e) {
      onError(loadError(e, 'Failed to update outcome'));
    }
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select style={selectStyle} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Set…</option>
        {OUTCOME_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Button variant="secondary" onClick={apply} disabled={!value}>Update</Button>
    </div>
  );
}