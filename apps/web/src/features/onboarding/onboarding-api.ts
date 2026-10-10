import type {
  OnboardingAccountResponseDto,
  OnboardingCompletionDto,
  OnboardingImportResultDto,
  OnboardingModuleOptionDto,
  OnboardingPlanOptionDto,
  OnboardingSessionDto,
} from '@college-erp/types';

const API_URL = import.meta.env.VITE_API_URL as string;
const STORAGE_KEY = 'college_erp_onboarding_token';

/** The opaque wizard token minted by POST /onboarding/account — persisted so the flow is resumable. */
export function getOnboardingToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setOnboardingToken(token: string | null): void {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export class OnboardingApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OnboardingApiError';
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
}

async function onboardingFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token ?? getOnboardingToken();
  if (token) {
    headers['X-Onboarding-Token'] = token;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: response.statusText }))) as { message?: string };
    throw new OnboardingApiError(response.status, body.message ?? 'Request failed');
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export interface OnboardingBrandingUploadTargetDto {
  kind: string;
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export const onboardingApi = {
  createAccount: (input: { fullName: string; email: string; password: string }) =>
    onboardingFetch<OnboardingAccountResponseDto>('/onboarding/account', { method: 'POST', body: input }),

  getSession: (token?: string | null) => onboardingFetch<OnboardingSessionDto>('/onboarding/session', { token }),

  listPlans: () => onboardingFetch<OnboardingPlanOptionDto[]>('/onboarding/plans'),

  listModules: () => onboardingFetch<OnboardingModuleOptionDto[]>('/onboarding/modules'),

  createCollege: (input: { slug: string; name: string; billingEmail?: string; timezone?: string }) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/college', { method: 'POST', body: input }),

  selectPlan: (planCode: string) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/plan', { method: 'POST', body: { planCode } }),

  configureBranding: (input: Record<string, unknown>) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/branding', { method: 'POST', body: input }),

  requestBrandingUpload: (kind: string, file: File) =>
    onboardingFetch<OnboardingBrandingUploadTargetDto>('/onboarding/branding/upload-url', {
      method: 'POST',
      body: { kind, filename: file.name, mimeType: file.type },
    }),

  confirmBrandingAsset: (kind: string, storageKey: string) =>
    onboardingFetch<{ asset: { url: string } }>('/onboarding/branding/asset', {
      method: 'POST',
      body: { kind, storageKey },
    }),

  academicStructure: (input: Record<string, unknown>) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/academic-structure', { method: 'POST', body: input }),

  configureModules: (input: { enable?: string[]; disable?: string[] }) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/modules', { method: 'POST', body: input }),

  importData: (input: { entity: string; csv: string; mode?: 'validate' | 'upsert' }) =>
    onboardingFetch<OnboardingImportResultDto>('/onboarding/data-import', { method: 'POST', body: input }),

  createAdministrator: (input: { email?: string; fullName?: string; phone?: string; password?: string }) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/administrator', { method: 'POST', body: input }),

  configureNotifications: (input: {
    channels?: string[];
    senderName?: string;
    senderEmail?: string;
    replyToEmail?: string;
    supportEmail?: string;
  }) => onboardingFetch<OnboardingSessionDto>('/onboarding/notifications', { method: 'POST', body: input }),

  skipStep: (step: string) =>
    onboardingFetch<OnboardingSessionDto>('/onboarding/skip', { method: 'POST', body: { step } }),

  complete: () => onboardingFetch<OnboardingCompletionDto>('/onboarding/complete', { method: 'POST' }),
};

/** Uploads a logo straight to storage via the presigned URL, then confirms it, returning the
 *  public asset path the branding section stores. */
export async function uploadOnboardingLogo(file: File): Promise<string> {
  const target = await onboardingApi.requestBrandingUpload('logo', file);
  const put = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) {
    throw new Error('Upload to storage failed.');
  }
  const confirmed = await onboardingApi.confirmBrandingAsset('logo', target.storageKey);
  return confirmed.asset.url;
}
