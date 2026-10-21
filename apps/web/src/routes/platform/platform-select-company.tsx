import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlatformTenantDto } from '@college-erp/types';
import { Button, Spinner } from '@college-erp/ui';
import { Icon } from '../../app/icons';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';
import { isPlatformAdmin } from '../../features/platform-auth/platform-access';
import {
  clearActiveCompany,
  companyAccent,
  companyInitials,
  readActiveCompany,
  writeActiveCompany,
} from '../../features/platform-auth/platform-company';
import { platformApiFetch } from '../../lib/platform-http';

const STATUS_TONE: Record<PlatformTenantDto['status'], { label: string; color: string; background: string }> = {
  TRIAL: { label: 'Trial', color: '#0369a1', background: '#e0f2fe' },
  ACTIVE: { label: 'Active', color: '#15803d', background: '#dcfce7' },
  SUSPENDED: { label: 'Suspended', color: '#b45309', background: '#fef3c7' },
  CANCELED: { label: 'Canceled', color: '#64748b', background: '#f1f5f9' },
};

const styles = `
.company-picker { min-height: 100vh; background: #f6f8fb; }
.company-picker__bar {
  height: 60px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 clamp(1rem, 4vw, 2.5rem); background: #fff; border-bottom: 1px solid #e2e8f0;
}
.company-picker__brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.02em; color: #0f172a; }
.company-picker__brand-mark {
  width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: #fff;
  background: linear-gradient(145deg, #3b82f6, #1d4ed8); font-size: 0.7rem; font-weight: 800;
}
.company-picker__account { display: flex; align-items: center; gap: 12px; }
.company-picker__avatar {
  width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center;
  background: #0f172a; color: #fff; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
}
.company-picker__body { display: flex; justify-content: center; padding: clamp(1.5rem, 6vh, 3.5rem) 1rem 3rem; }
.company-picker__card {
  width: 100%; max-width: 460px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  padding: 1.9rem 1.6rem 1.5rem; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.10);
}
.company-picker__icon {
  width: 54px; height: 54px; border-radius: 14px; display: grid; place-items: center; margin: 0 auto 0.9rem;
  color: #1d4ed8; background: #eff6ff; border: 1px solid #dbeafe;
}
.company-picker__title { margin: 0; text-align: center; font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em; color: #0f172a; }
.company-picker__sub { margin: 0.3rem 0 1.4rem; text-align: center; font-size: 0.84rem; color: #64748b; }
.company-picker__list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; padding: 2px; }
.company-picker__option {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 0.7rem 0.85rem;
  border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}
.company-picker__option:hover { border-color: #cbd5e1; background: #f8fafc; }
.company-picker__option--selected { border-color: #ea580c; background: #fff7ed; box-shadow: 0 0 0 1px #ea580c inset; }
.company-picker__monogram {
  width: 30px; height: 30px; flex: none; border-radius: 999px; display: grid; place-items: center;
  color: #fff; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.02em;
}
.company-picker__name { font-size: 0.88rem; font-weight: 650; color: #0f172a; line-height: 1.25; }
.company-picker__slug { font-size: 0.72rem; color: #64748b; }
.company-picker__status { margin-left: auto; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
.company-picker__check { margin-left: auto; color: #ea580c; display: grid; place-items: center; }
.company-picker__actions { display: flex; flex-direction: column; gap: 7px; margin-top: 1.25rem; padding-top: 1.15rem; border-top: 1px solid #e2e8f0; }
.company-picker__link {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 0.55rem 0.75rem;
  border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #334155; font-size: 0.82rem;
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
}
.company-picker__link:hover { background: #f8fafc; border-color: #cbd5e1; }
.company-picker__link--danger { color: #b91c1c; }
.company-picker__empty { padding: 1.5rem 0.5rem; text-align: center; color: #64748b; font-size: 0.86rem; }
.company-picker__search { margin-bottom: 0.75rem; }
.company-picker__search input { width: 100%; }
.company-picker__error { margin-top: 0.75rem; color: #b91c1c; font-size: 0.82rem; }
`;

/**
 * The superadmin's "Select Company" landing screen.
 *
 * Deliberately outside PlatformLayout: it is the first screen after sign-in, so it uses its own
 * minimal top bar rather than the full console chrome. Every action here is a link into the
 * console — nothing on this page mutates a tenant, so a PLATFORM_SUPPORT account can use it to
 * pick a tenant for read-only triage while the admin-only actions stay hidden.
 */
export function PlatformSelectCompanyPage() {
  const navigate = useNavigate();
  const { platformUser, logout } = usePlatformAuth();
  const [companies, setCompanies] = useState<PlatformTenantDto[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => readActiveCompany()?.id ?? '');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = isPlatformAdmin(platformUser?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenants = await platformApiFetch<PlatformTenantDto[]>('/tenants?take=200&sortBy=name&sortOrder=asc');
      setCompanies(tenants);
      setSelectedId((current) => {
        if (current && tenants.some((tenant) => tenant.id === current)) return current;
        return tenants[0]?.id ?? '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load companies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleCompanies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter(
      (company) =>
        company.name.toLowerCase().includes(needle) ||
        company.slug.toLowerCase().includes(needle) ||
        company.billingEmail.toLowerCase().includes(needle),
    );
  }, [companies, query]);

  const selected = companies.find((company) => company.id === selectedId) ?? null;

  const enterSelected = () => {
    if (!selected) return;
    writeActiveCompany({ id: selected.id, name: selected.name, slug: selected.slug });
    navigate(`/platform/tenants/${selected.id}`);
  };

  const handleLogout = async () => {
    clearActiveCompany();
    await logout();
    navigate('/platform/login', { replace: true });
  };

  const initials = (platformUser?.fullName ?? platformUser?.email ?? 'SA')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="company-picker">
      <style>{styles}</style>

      <header className="company-picker__bar">
        <div className="company-picker__brand">
          <span className="company-picker__brand-mark">CE</span>
          <span>
            College<span style={{ fontWeight: 400, color: '#2563eb' }}>ERP</span>
          </span>
          <span
            style={{
              marginLeft: 10,
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: '#94a3b8',
              textTransform: 'uppercase',
            }}
          >
            Platform
          </span>
        </div>
        <div className="company-picker__account">
          <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a' }}>{platformUser?.fullName}</div>
            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{platformUser?.role}</div>
          </div>
          <span className="company-picker__avatar" title={platformUser?.email}>
            {initials || 'SA'}
          </span>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="company-picker__body">
        <div className="company-picker__card">
          <div className="company-picker__icon">
            <Icon name="campuses" size={24} />
          </div>
          <h1 className="company-picker__title">Select Company</h1>
          <p className="company-picker__sub">Choose which company workspace to enter</p>

          {companies.length > 6 && (
            <div className="company-picker__search">
              <input
                aria-label="Search companies"
                placeholder="Search companies…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
            </div>
          )}

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0', color: '#64748b', gap: 10 }}>
              <Spinner /> Loading companies…
            </div>
          ) : error ? (
            <div className="company-picker__empty">
              <p style={{ color: '#b91c1c' }}>{error}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : visibleCompanies.length === 0 ? (
            <div className="company-picker__empty">
              {companies.length === 0
                ? 'No companies exist yet. Onboard the first tenant to get started.'
                : 'No company matches that search.'}
            </div>
          ) : (
            <div className="company-picker__list" role="radiogroup" aria-label="Companies">
              {visibleCompanies.map((company) => {
                const isSelected = company.id === selectedId;
                const tone = STATUS_TONE[company.status];
                return (
                  <button
                    key={company.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedId(company.id)}
                    onDoubleClick={() => {
                      writeActiveCompany({ id: company.id, name: company.name, slug: company.slug });
                      navigate(`/platform/tenants/${company.id}`);
                    }}
                    className={`company-picker__option${isSelected ? ' company-picker__option--selected' : ''}`}
                  >
                    <span className="company-picker__monogram" style={{ background: companyAccent(company.id) }}>
                      {companyInitials(company.name)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="company-picker__name" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {company.name}
                      </span>
                      <span className="company-picker__slug">{company.slug}</span>
                    </span>
                    {isSelected ? (
                      <span className="company-picker__check">
                        <Icon name="chevron" size={18} />
                      </span>
                    ) : (
                      <span className="company-picker__status" style={{ color: tone.color, background: tone.background }}>
                        {tone.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <Button block disabled={!selected} onClick={enterSelected}>
              Continue
            </Button>
          </div>

          <div className="company-picker__actions">
            {isAdmin && (
              <button type="button" className="company-picker__link" onClick={() => navigate('/platform/tenants/new')}>
                <Icon name="plus" size={15} /> Onboard a Tenant
              </button>
            )}
            <button type="button" className="company-picker__link" onClick={() => navigate('/platform/tenants')}>
              <Icon name="campuses" size={15} /> Manage Tenants
            </button>
            {isAdmin && (
              <button type="button" className="company-picker__link" onClick={() => navigate('/platform/users')}>
                <Icon name="users" size={15} /> User Management
              </button>
            )}
            {isAdmin && (
              <button type="button" className="company-picker__link" onClick={() => navigate('/platform/maintenance')}>
                <Icon name="settings" size={15} /> Maintenance Mode
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
