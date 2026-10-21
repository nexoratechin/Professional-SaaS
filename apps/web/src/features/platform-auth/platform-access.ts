import type { PlatformUserDto } from '@college-erp/types';

/**
 * Client-side access policy for the platform (SaaS control-plane) area.
 *
 * This mirrors the API's `@RequirePlatformRole` decorators; it is a UX gate, never the
 * enforcement. Every platform endpoint is still guarded server-side, so hiding a link here can
 * only remove a button that would otherwise return 403.
 *
 * Two roles exist:
 *   - PLATFORM_ADMIN   — full control plane (tenant lifecycle, billing, plans, audit log).
 *   - PLATFORM_SUPPORT — read-only triage (dashboard, analytics, tenant lookup, support tickets).
 */
export type PlatformRole = PlatformUserDto['role'];

export type PlatformSectionKey =
  | 'dashboard'
  | 'analytics'
  | 'tenants'
  | 'users'
  | 'billing'
  | 'catalog'
  | 'support'
  | 'maintenance'
  | 'audit-log';

export interface PlatformSection {
  key: PlatformSectionKey;
  to: string;
  label: string;
  /** Roles that may render the section. Empty would mean "nobody"; unknown roles are denied. */
  roles: readonly PlatformRole[];
}

const ADMIN_ONLY: readonly PlatformRole[] = ['PLATFORM_ADMIN'];
const ALL_PLATFORM_ROLES: readonly PlatformRole[] = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'];

export const PLATFORM_SECTIONS: readonly PlatformSection[] = [
  { key: 'dashboard', to: '/platform/dashboard', label: 'Dashboard', roles: ALL_PLATFORM_ROLES },
  { key: 'analytics', to: '/platform/analytics', label: 'Analytics', roles: ALL_PLATFORM_ROLES },
  { key: 'tenants', to: '/platform/tenants', label: 'Tenants', roles: ALL_PLATFORM_ROLES },
  { key: 'users', to: '/platform/users', label: 'User Management', roles: ADMIN_ONLY },
  { key: 'billing', to: '/platform/billing', label: 'Billing', roles: ADMIN_ONLY },
  { key: 'catalog', to: '/platform/catalog', label: 'Plans & Features', roles: ADMIN_ONLY },
  { key: 'support', to: '/platform/support', label: 'Support', roles: ALL_PLATFORM_ROLES },
  { key: 'maintenance', to: '/platform/maintenance', label: 'Maintenance', roles: ADMIN_ONLY },
  { key: 'audit-log', to: '/platform/audit-log', label: 'Audit Log', roles: ADMIN_ONLY },
];

/** Runtime validation for values that arrive from storage or the network. */
export function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'PLATFORM_ADMIN' || value === 'PLATFORM_SUPPORT';
}

export function isPlatformAdmin(role: PlatformRole | null | undefined): boolean {
  return role === 'PLATFORM_ADMIN';
}

/**
 * Fail closed: a missing/unknown role gets nothing, and an unknown section key is denied so a
 * newly added route cannot silently inherit access.
 */
export function canAccessPlatformSection(
  role: PlatformRole | null | undefined,
  key: PlatformSectionKey,
): boolean {
  if (!isPlatformRole(role)) return false;
  const section = PLATFORM_SECTIONS.find((candidate) => candidate.key === key);
  return section ? section.roles.includes(role) : false;
}

/** Links the shell renders for a role, in declaration order. */
export function visiblePlatformSections(role: PlatformRole | null | undefined): PlatformSection[] {
  if (!isPlatformRole(role)) return [];
  return PLATFORM_SECTIONS.filter((section) => section.roles.includes(role));
}

/**
 * Resolve a `/platform/...` pathname to the section that owns it. Longest match wins so
 * `/platform/tenants/new` resolves to `tenants`, not to a hypothetical `/platform/ten` prefix.
 */
export function platformSectionForPath(pathname: string): PlatformSection | undefined {
  const trimmed = pathname.replace(/\/+$/, '');
  // `/platform` and `/platform/` are the area root; the area redirects them to the dashboard.
  const normalized = trimmed === '' || trimmed === '/platform' ? '/platform/dashboard' : trimmed;
  return [...PLATFORM_SECTIONS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((section) => normalized === section.to || normalized.startsWith(`${section.to}/`));
}

/** Convenience for route guards: may this role open this URL at all? */
export function canAccessPlatformPath(role: PlatformRole | null | undefined, pathname: string): boolean {
  const section = platformSectionForPath(pathname);
  if (!section) return false;
  return canAccessPlatformSection(role, section.key);
}
