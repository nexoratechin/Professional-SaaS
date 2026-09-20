import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PlatformLoginResultDto, PlatformUserDto } from '@college-erp/types';
import { platformApiFetch, setPlatformAccessToken, tryPlatformRefresh } from '../../lib/platform-http';

/** Entirely separate from features/auth/auth-context.tsx — see lib/platform-http.ts's doc
 * comment for why the two realms deliberately share no state. Restoring a platform session on
 * mount never touches tenant state, and vice versa. */
interface PlatformAuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  platformUser: PlatformUserDto | null;
}

interface PlatformAuthContextValue extends PlatformAuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

export function PlatformAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlatformAuthState>({ status: 'loading', platformUser: null });

  useEffect(() => {
    tryPlatformRefresh()
      .then(async (refreshed) => {
        if (!refreshed) {
          setState({ status: 'unauthenticated', platformUser: null });
          return;
        }
        const platformUser = await platformApiFetch<PlatformUserDto>('/platform/auth/me');
        setState({ status: 'authenticated', platformUser });
      })
      .catch(() => setState({ status: 'unauthenticated', platformUser: null }));
    // Runs once on mount to restore a platform session from its own refresh-token cookie, if any.
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await platformApiFetch<PlatformLoginResultDto>('/platform/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email, password }),
    });
    if (response.mfaRequired) {
      // MFA-challenge UI isn't built for either realm yet (see apps/web's tenant login page) —
      // an MFA-enrolled platform admin must use a non-MFA account until that lands.
      throw new Error('This platform account requires MFA, which the admin UI does not support yet.');
    }
    setPlatformAccessToken(response.accessToken);
    setState({ status: 'authenticated', platformUser: response.platformUser });
  }, []);

  const logout = useCallback(async () => {
    await platformApiFetch('/platform/auth/logout', { method: 'POST' }).catch(() => undefined);
    setPlatformAccessToken(null);
    setState({ status: 'unauthenticated', platformUser: null });
  }, []);

  const value = useMemo<PlatformAuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);

  return <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) {
    throw new Error('usePlatformAuth must be used within a PlatformAuthProvider');
  }
  return ctx;
}
