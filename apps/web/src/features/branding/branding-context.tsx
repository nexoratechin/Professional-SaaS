import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { BrandingAssetKind, BrandingAssetDto, BrandingAssetUploadUrlDto, PublicTenantBrandingDto } from '@college-erp/types';
import { apiFetch } from '../../lib/http';
import { useAuth } from '../auth/auth-context';

const API_URL = import.meta.env.VITE_API_URL as string;
const BRANDING_STYLE_ID = 'college-erp-tenant-branding';

/** Resolves a branding asset path (relative API path or absolute external URL) to a browser URL. */
export function brandingAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path}`;
}

// ── Color helpers (brand primary → a small, predictable palette) ──────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(color: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return null;
  const hex = match[1]!.length === 3 ? match[1]!.split('').map((c) => c + c).join('') : match[1]!;
  const int = Number.parseInt(hex, 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Mix a color toward white (amount = how much white, 0..1). */
function lighten(color: string, amount: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return toHex({ r: rgb.r + (255 - rgb.r) * amount, g: rgb.g + (255 - rgb.g) * amount, b: rgb.b + (255 - rgb.b) * amount });
}

/** Mix a color toward black (amount = how much black, 0..1). */
function darken(color: string, amount: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return toHex({ r: rgb.r * (1 - amount), g: rgb.g * (1 - amount), b: rgb.b * (1 - amount) });
}

function luminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 1;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

/** Applies the tenant palette as CSS custom-property overrides and swaps the favicon. Kept out of
 *  React render so a re-fetch never flashes the platform defaults. */
function applyBranding(branding: PublicTenantBrandingDto): void {
  const { primaryColor, secondaryColor, accentColor } = branding;
  const sidebar = luminance(secondaryColor) < 0.5 ? secondaryColor : darken(primaryColor, 0.25);
  const css = `:root {
  --ui-color-primary: ${primaryColor};
  --ui-color-primary-hover: ${darken(primaryColor, 0.12)};
  --ui-color-primary-soft: ${lighten(primaryColor, 0.9)};
  --ui-color-ring: ${primaryColor};
  --ui-color-secondary: ${secondaryColor};
  --ui-color-accent: ${accentColor ?? primaryColor};
  --ui-color-sidebar: ${sidebar};
  --ui-color-sidebar-active: ${darken(primaryColor, 0.08)};
}`;

  let style = document.getElementById(BRANDING_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = BRANDING_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;

  const favicon = brandingAssetUrl(branding.faviconUrl);
  if (favicon) {
    document.querySelectorAll("link[rel~='icon']").forEach((node) => node.parentNode?.removeChild(node));
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = favicon;
    document.head.appendChild(link);
  }
}

interface BrandingContextValue {
  branding: PublicTenantBrandingDto | null;
  loading: boolean;
  error: string | null;
  /** Preview branding for a tenant slug typed on the login page, before authentication. */
  previewTenant: (slug: string) => void;
  clearPreview: () => void;
  refresh: () => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

/**
 * Loads and applies the current tenant's white-label branding. The tenant is identified by the
 * authenticated session's slug, with an optional login-page preview slug override. All reads go
 * through the tenant-scoped public branding endpoint, so one tenant's branding can never leak into
 * another's session.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { tenantSlug: authTenantSlug } = useAuth();
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [branding, setBranding] = useState<PublicTenantBrandingDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const slug = (previewSlug ?? authTenantSlug ?? '').trim();

  useEffect(() => {
    if (!slug) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<PublicTenantBrandingDto>(`/public/branding/${encodeURIComponent(slug)}`, { skipAuth: true })
      .then((data) => {
        if (cancelled) return;
        setBranding(data);
        applyBranding(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load branding.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, nonce]);

  const previewTenant = useCallback((next: string) => {
    setPreviewSlug(next.trim() ? next.trim() : null);
  }, []);
  const clearPreview = useCallback(() => setPreviewSlug(null), []);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  const value = useMemo<BrandingContextValue>(
    () => ({ branding, loading, error, previewTenant, clearPreview, refresh }),
    [branding, loading, error, previewTenant, clearPreview, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return ctx;
}

// ── Branding admin helpers (shared with the settings page) ───────────────────

export async function requestBrandingAssetUpload(
  kind: BrandingAssetKind,
  file: File,
): Promise<BrandingAssetUploadUrlDto> {
  return apiFetch<BrandingAssetUploadUrlDto>('/tenant/branding/assets/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind, filename: file.name, mimeType: file.type }),
  });
}

/** Uploads the file straight to storage via the presigned URL, then confirms it with the API. */
export async function uploadBrandingAsset(kind: BrandingAssetKind, file: File): Promise<BrandingAssetDto> {
  const target = await requestBrandingAssetUpload(kind, file);
  const put = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) {
    throw new Error('Upload to storage failed.');
  }
  return apiFetch<BrandingAssetDto>(`/tenant/branding/assets/${kind}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ storageKey: target.storageKey }),
  });
}

export async function removeBrandingAsset(kind: BrandingAssetKind): Promise<void> {
  await apiFetch(`/tenant/branding/assets/${kind}`, { method: 'DELETE' });
}
