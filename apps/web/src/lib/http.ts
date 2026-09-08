const API_URL = import.meta.env.VITE_API_URL as string;
const DEV_TENANT_SLUG = import.meta.env.VITE_DEV_TENANT_SLUG as string | undefined;

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions extends RequestInit {
  tenantSlug?: string;
  skipAuth?: boolean;
}

function resolveTenantSlug(explicit?: string): string | undefined {
  return explicit ?? DEV_TENANT_SLUG ?? undefined;
}

async function rawFetch(path: string, options: ApiFetchOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const tenantSlug = resolveTenantSlug(options.tenantSlug);
  if (tenantSlug) {
    headers.set('X-Tenant-Slug', tenantSlug);
  }
  if (accessToken && !options.skipAuth) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  // credentials: 'include' — the refresh token lives in an httpOnly cookie the browser must
  // send/receive automatically; the frontend never touches its value directly.
  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
}

async function tryRefresh(tenantSlug?: string): Promise<boolean> {
  const response = await rawFetch('/auth/refresh', { method: 'POST', skipAuth: true, tenantSlug });
  if (!response.ok) {
    accessToken = null;
    return false;
  }
  const data = (await response.json()) as { accessToken: string };
  accessToken = data.accessToken;
  return true;
}

/** Attaches the tenant header + bearer token, and silently refreshes the access token once on a
 * 401 before giving up. Shared by apiFetch and apiFetchPaged below. */
async function fetchWithAuthRetry(path: string, options: ApiFetchOptions): Promise<Response> {
  let response = await rawFetch(path, options);

  if (response.status === 401 && !options.skipAuth) {
    const refreshed = await tryRefresh(options.tenantSlug);
    if (refreshed) {
      response = await rawFetch(path, options);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, (body as { message?: string }).message ?? 'Request failed');
  }

  return response;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await fetchWithAuthRetry(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export interface PagedResult<T> {
  data: T;
  /** From the X-Total-Count response header — the full matching row count, not just this page. */
  total: number;
}

/** Same auth/retry behavior as apiFetch, but also surfaces the X-Total-Count header — for
 * endpoints (like the searchable audit log) whose body stays a plain array for backward
 * compatibility while pagination metadata rides along as a header instead. */
export async function apiFetchPaged<T>(path: string, options: ApiFetchOptions = {}): Promise<PagedResult<T>> {
  const response = await fetchWithAuthRetry(path, options);
  const total = Number(response.headers.get('X-Total-Count') ?? '0');
  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { data, total };
}

export { tryRefresh };
