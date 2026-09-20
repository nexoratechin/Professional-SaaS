/**
 * Deliberately independent from lib/http.ts — separate module-level token variable, separate
 * refresh endpoint, and NEVER an X-Tenant-Slug header. This is the architectural boundary behind
 * "a platform admin must not accidentally operate inside a tenant": the platform realm's HTTP
 * client has no code path that could ever attach tenant context, and the tenant realm's client
 * (lib/http.ts) has no access to the platform token. A bug in one cannot leak into the other
 * because they don't share state at all, not because of a runtime check.
 */
const API_URL = import.meta.env.VITE_API_URL as string;

let platformAccessToken: string | null = null;

export function setPlatformAccessToken(token: string | null): void {
  platformAccessToken = token;
}

export function getPlatformAccessToken(): string | null {
  return platformAccessToken;
}

export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformApiError';
  }
}

interface PlatformApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

async function rawFetch(path: string, options: PlatformApiFetchOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (platformAccessToken && !options.skipAuth) {
    headers.set('Authorization', `Bearer ${platformAccessToken}`);
  }

  // credentials: 'include' — the platform refresh token lives in its own httpOnly cookie,
  // distinct from the tenant realm's (see apps/api's platform-auth.controller.ts).
  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
}

async function tryPlatformRefresh(): Promise<boolean> {
  const response = await rawFetch('/platform/auth/refresh', { method: 'POST', skipAuth: true });
  if (!response.ok) {
    platformAccessToken = null;
    return false;
  }
  const data = (await response.json()) as { accessToken: string };
  platformAccessToken = data.accessToken;
  return true;
}

async function fetchWithAuthRetry(path: string, options: PlatformApiFetchOptions): Promise<Response> {
  let response = await rawFetch(path, options);

  if (response.status === 401 && !options.skipAuth) {
    const refreshed = await tryPlatformRefresh();
    if (refreshed) {
      response = await rawFetch(path, options);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new PlatformApiError(response.status, (body as { message?: string }).message ?? 'Request failed');
  }

  return response;
}

export async function platformApiFetch<T>(path: string, options: PlatformApiFetchOptions = {}): Promise<T> {
  const response = await fetchWithAuthRetry(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export interface PlatformPagedResult<T> {
  data: T;
  total: number;
}

export async function platformApiFetchPaged<T>(
  path: string,
  options: PlatformApiFetchOptions = {},
): Promise<PlatformPagedResult<T>> {
  const response = await fetchWithAuthRetry(path, options);
  const total = Number(response.headers.get('X-Total-Count') ?? '0');
  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { data, total };
}

export { tryPlatformRefresh };
