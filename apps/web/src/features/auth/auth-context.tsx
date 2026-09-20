import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CurrentUserDto, EffectiveEntitlementsResponseDto, FeatureFlagsResponseDto, LoginResponseDto, PermissionsResponseDto } from '@college-erp/types';
import { apiFetch, setAccessToken, tryRefresh } from '../../lib/http';

const TENANT_SLUG_STORAGE_KEY = 'college_erp_tenant_slug';

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: CurrentUserDto | null;
  permissions: string[];
  features: Record<string, boolean>;
  /** Granular capability flags (e.g. attendance.qr), resolved via the centralized entitlement
   * gateway — available to every authenticated role for navigation/UI gating. */
  entitlements: Record<string, boolean>;
  hasFetchedEntitlements: boolean;
  tenantSlug: string | null;
}

interface AuthContextValue extends AuthState {
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
    permissions: [],
    features: {},
    entitlements: {},
    hasFetchedEntitlements: false,
    tenantSlug: localStorage.getItem(TENANT_SLUG_STORAGE_KEY),
  });

  const loadProfile = useCallback(async (tenantSlug: string) => {
    const [user, permissionsRes, entitlementsRes] = await Promise.all([
      apiFetch<CurrentUserDto>('/auth/me', { tenantSlug }),
      apiFetch<PermissionsResponseDto>('/auth/permissions', { tenantSlug }),
      apiFetch<EffectiveEntitlementsResponseDto>('/tenant/entitlements/effective', { tenantSlug }).catch(() => null),
    ]);

    let features: Record<string, boolean> = {};
    try {
      const featuresRes = await apiFetch<FeatureFlagsResponseDto>('/tenant/features', { tenantSlug });
      features = featuresRes.features;
    } catch {
      // Viewing feature flags requires tenant.features.manage — not every role has it.
      features = {};
    }

    const entitlements = entitlementsRes?.entitlements ?? {};
    const hasFetchedEntitlements = entitlementsRes !== null;

    setState({
      status: 'authenticated',
      user,
      permissions: permissionsRes.permissions,
      features,
      entitlements,
      hasFetchedEntitlements,
      tenantSlug,
    });
  }, []);

  useEffect(() => {
    const tenantSlug = state.tenantSlug;
    if (!tenantSlug) {
      setState((prev) => ({ ...prev, status: 'unauthenticated' }));
      return;
    }

    tryRefresh(tenantSlug)
      .then((refreshed) => {
        if (!refreshed) {
          setState((prev) => ({ ...prev, status: 'unauthenticated' }));
          return;
        }
        return loadProfile(tenantSlug);
      })
      .catch(() => setState((prev) => ({ ...prev, status: 'unauthenticated' })));
    // Runs once on mount to restore a session from the refresh-token cookie, if any.
  }, []);

  const login = useCallback(
    async (tenantSlug: string, email: string, password: string) => {
      const response = await apiFetch<LoginResponseDto>('/auth/login', {
        method: 'POST',
        tenantSlug,
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(response.accessToken);
      localStorage.setItem(TENANT_SLUG_STORAGE_KEY, tenantSlug);
      await loadProfile(tenantSlug);
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    if (state.tenantSlug) {
      await apiFetch('/auth/logout', { method: 'POST', tenantSlug: state.tenantSlug }).catch(() => undefined);
    }
    setAccessToken(null);
    localStorage.removeItem(TENANT_SLUG_STORAGE_KEY);
    setState({
      status: 'unauthenticated',
      user: null,
      permissions: [],
      features: {},
      entitlements: {},
      hasFetchedEntitlements: false,
      tenantSlug: null,
    });
  }, [state.tenantSlug]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * Granular entitlement hook for feature-aware UI/navigation. The backend's
 * EntitlementsGatewayService already returns a fully-resolved entitlements map (granular key OR
 * its module flag — module-fallback applied server-side), so the frontend can read the resolved
 * boolean directly and never needs to re-derive module fallbacks.
 *
 * While entitlements haven't loaded yet (`hasFetchedEntitlements = false` — still on the login
 * page / session restore), this returns true so navigation never flashes away a screen the user
 * is legitimately entitled to. Once loaded, it returns exactly what the gateway resolved. The
 * authoritative gate remains the API (FeatureFlagsGuard/EntitlementFlagsGuard) — this hook only
 * decides whether to render nav links and buttons.
 */
export function useEntitlement(key: string): boolean {
  const { entitlements, hasFetchedEntitlements } = useAuth();
  if (!hasFetchedEntitlements) {
    return true;
  }
  return entitlements[key] === true;
}
