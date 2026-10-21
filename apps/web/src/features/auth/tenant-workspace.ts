import type { TenantWorkspaceDto } from '@college-erp/types';

/**
 * The workspace picker must render before a session exists (that is the whole point: the user
 * signed out of college A and is choosing college B), so the last known directory is cached.
 *
 * This cache is a *hint for rendering only*: it is never used to authorize anything, and the API
 * re-derives memberships from the control-plane table on every login. Anything malformed is
 * dropped rather than trusted.
 */
export const TENANT_OPTIONS_STORAGE_KEY = 'college_erp_tenant_options';
export const LAST_EMAIL_STORAGE_KEY = 'college_erp_last_email';

const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'] as const;

function isWorkspace(value: unknown): value is TenantWorkspaceDto {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === 'string' &&
    candidate.slug.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.status === 'string' &&
    (TENANT_STATUSES as readonly string[]).includes(candidate.status) &&
    typeof candidate.isCurrent === 'boolean'
  );
}

type ReadableStorage = Pick<Storage, 'getItem'>;

export function readCachedWorkspaces(storage: ReadableStorage = localStorage): TenantWorkspaceDto[] {
  try {
    const raw = storage.getItem(TENANT_OPTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((entry): entry is TenantWorkspaceDto => {
      if (!isWorkspace(entry) || seen.has(entry.slug)) return false;
      seen.add(entry.slug);
      return true;
    });
  } catch {
    return [];
  }
}

type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function writeCachedWorkspaces(
  tenants: TenantWorkspaceDto[],
  storage: WritableStorage = localStorage,
): void {
  try {
    if (tenants.length === 0) {
      storage.removeItem(TENANT_OPTIONS_STORAGE_KEY);
      return;
    }
    storage.setItem(TENANT_OPTIONS_STORAGE_KEY, JSON.stringify(tenants));
  } catch {
    // Private mode / quota: the picker simply falls back to the login form.
  }
}

export function readLastEmail(storage: ReadableStorage = localStorage): string | null {
  try {
    const email = storage.getItem(LAST_EMAIL_STORAGE_KEY)?.trim();
    return email ? email : null;
  } catch {
    return null;
  }
}

export function writeLastEmail(email: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    if (email.trim()) storage.setItem(LAST_EMAIL_STORAGE_KEY, email.trim());
  } catch {
    // Non-fatal.
  }
}

/** More than one workspace is the only case that needs a picker; one is auto-continued. */
export function needsWorkspacePicker(tenants: TenantWorkspaceDto[]): boolean {
  return tenants.length > 1;
}

export function findWorkspace(
  tenants: TenantWorkspaceDto[],
  slug: string | null | undefined,
): TenantWorkspaceDto | undefined {
  if (!slug) return undefined;
  return tenants.find((tenant) => tenant.slug === slug);
}

/** Login URL for a workspace that is not the current session's tenant. */
export function workspaceLoginPath(slug: string, email: string | null): string {
  const params = new URLSearchParams({ tenant: slug });
  if (email) params.set('email', email);
  return `/login?${params.toString()}`;
}
