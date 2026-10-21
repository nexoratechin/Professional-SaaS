import type { PlatformTenantDto } from '@college-erp/types';

/**
 * The company a superadmin last opened from the company picker. Purely a convenience for
 * navigation ("back to <company>") — it is never sent to the API and carries no authority. Every
 * company page is still fetched by id from `/tenants/:id` with the platform token, so a stale or
 * tampered value can only produce a 404/403, never cross-tenant access.
 */
export type ActiveCompany = Pick<PlatformTenantDto, 'id' | 'name' | 'slug'>;

const STORAGE_KEY = 'college-erp.platform.active-company';

export function readActiveCompany(): ActiveCompany | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveCompany>;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string' || typeof parsed.slug !== 'string') {
      return null;
    }
    return { id: parsed.id, name: parsed.name, slug: parsed.slug };
  } catch {
    return null;
  }
}

export function writeActiveCompany(company: ActiveCompany): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(company));
  } catch {
    // Storage can be unavailable (private mode / quota). The picker still works; only the
    // "last opened" shortcut is lost.
  }
}

export function clearActiveCompany(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Two-letter monogram used by the picker and header when a company has no logo asset. */
export function companyInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const last = words[words.length - 1] ?? first;
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

/** Deterministic accent per company id, so the same company always gets the same swatch. */
const ACCENTS = ['#ea580c', '#db2777', '#0f172a', '#059669', '#7c3aed', '#0284c7', '#b45309'] as const;
export function companyAccent(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length] ?? '#0f172a';
}
