import React from 'react';

/**
 * Design tokens for the College ERP design system.
 *
 * The authoritative values live in the CSS custom properties emitted by {@link globalStyles}; this
 * object is the JS mirror for the few places that need a raw value (inline widths, chart palettes,
 * canvas drawing). Prefer the CSS variables (`var(--ui-color-primary)`) in component styles so a
 * theme override in one place propagates everywhere.
 */
export const tokens = {
  color: {
    primary: '#1d4ed8',
    primaryHover: '#1e40af',
    primarySoft: '#eff6ff',
    bg: '#f6f8fb',
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    text: '#0f172a',
    textMuted: '#64748b',
    textSubtle: '#94a3b8',
    success: '#15803d',
    successSoft: '#f0fdf4',
    danger: '#dc2626',
    dangerHover: '#b91c1c',
    dangerSoft: '#fef2f2',
    warning: '#b45309',
    warningSoft: '#fffbeb',
    info: '#0369a1',
    infoSoft: '#f0f9ff',
    ring: '#2563eb',
    sidebar: '#0f172a',
    sidebarMuted: '#94a3b8',
    sidebarActive: '#1e293b',
  },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  shadow: {
    sm: '0 1px 2px rgba(15, 23, 42, 0.06)',
    md: '0 4px 12px rgba(15, 23, 42, 0.08)',
    lg: '0 20px 60px rgba(15, 23, 42, 0.25)',
  },
  font: {
    family:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    mono: "'SFMono-Regular', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  breakpoint: { sm: 640, md: 768, lg: 1024, xl: 1280 },
} as const;

export const GLOBAL_STYLE_ID = 'college-erp-ui-global';

/**
 * The single global stylesheet for the design system. Injected once at the app root by
 * {@link GlobalStyles}. Because every existing page either sets its own inline styles (which win
 * over these base rules) or has none, importing this upgrades typography, spacing, focus rings,
 * form controls and tables across the whole app without touching page code.
 */
export const globalStyles = `
:root {
  --ui-color-primary: ${tokens.color.primary};
  --ui-color-primary-hover: ${tokens.color.primaryHover};
  --ui-color-primary-soft: ${tokens.color.primarySoft};
  --ui-color-bg: ${tokens.color.bg};
  --ui-color-surface: ${tokens.color.surface};
  --ui-color-surface-muted: ${tokens.color.surfaceMuted};
  --ui-color-border: ${tokens.color.border};
  --ui-color-border-strong: ${tokens.color.borderStrong};
  --ui-color-text: ${tokens.color.text};
  --ui-color-text-muted: ${tokens.color.textMuted};
  --ui-color-text-subtle: ${tokens.color.textSubtle};
  --ui-color-success: ${tokens.color.success};
  --ui-color-success-soft: ${tokens.color.successSoft};
  --ui-color-danger: ${tokens.color.danger};
  --ui-color-danger-hover: ${tokens.color.dangerHover};
  --ui-color-danger-soft: ${tokens.color.dangerSoft};
  --ui-color-warning: ${tokens.color.warning};
  --ui-color-warning-soft: ${tokens.color.warningSoft};
  --ui-color-info: ${tokens.color.info};
  --ui-color-info-soft: ${tokens.color.infoSoft};
  --ui-color-ring: ${tokens.color.ring};
  --ui-color-sidebar: ${tokens.color.sidebar};
  --ui-color-sidebar-muted: ${tokens.color.sidebarMuted};
  --ui-color-sidebar-active: ${tokens.color.sidebarActive};
  --ui-radius-sm: ${tokens.radius.sm}px;
  --ui-radius-md: ${tokens.radius.md}px;
  --ui-radius-lg: ${tokens.radius.lg}px;
  --ui-radius-pill: ${tokens.radius.pill}px;
  --ui-shadow-sm: ${tokens.shadow.sm};
  --ui-shadow-md: ${tokens.shadow.md};
  --ui-shadow-lg: ${tokens.shadow.lg};
  --ui-font: ${tokens.font.family};
  --ui-font-mono: ${tokens.font.mono};
  --ui-control-h: 38px;
  --ui-header-h: 60px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body { height: 100%; }

body {
  margin: 0;
  font-family: var(--ui-font);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ui-color-text);
  background: var(--ui-color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

#root { min-height: 100%; }

h1, h2, h3, h4, h5, h6 { margin: 0 0 0.5em; line-height: 1.25; font-weight: 650; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.2rem; }
h3 { font-size: 1.05rem; }
p { margin: 0 0 0.75em; }

a { color: var(--ui-color-primary); text-decoration: none; }
a:hover { text-decoration: underline; }

code, pre, kbd { font-family: var(--ui-font-mono); font-size: 0.85em; }

button, input, select, textarea { font: inherit; color: inherit; }

ul, ol { margin: 0 0 0.75em; padding-left: 1.25rem; }

:focus-visible {
  outline: 2px solid var(--ui-color-ring);
  outline-offset: 2px;
  border-radius: var(--ui-radius-sm);
}

.ui-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* ---------------------------------------------------------------- Buttons */
.ui-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--ui-control-h);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-md);
  font-weight: 600; font-size: 0.9rem; line-height: 1;
  cursor: pointer; white-space: nowrap;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease;
  text-decoration: none;
}
.ui-btn:hover { text-decoration: none; }
.ui-btn:disabled, .ui-btn[aria-disabled='true'] { cursor: not-allowed; opacity: .55; }
.ui-btn--primary { background: var(--ui-color-primary); color: #fff; box-shadow: var(--ui-shadow-sm); }
.ui-btn--primary:hover:not(:disabled) { background: var(--ui-color-primary-hover); }
.ui-btn--secondary { background: var(--ui-color-surface); color: var(--ui-color-text); border-color: var(--ui-color-border-strong); }
.ui-btn--secondary:hover:not(:disabled) { background: var(--ui-color-surface-muted); border-color: var(--ui-color-text-subtle); }
.ui-btn--ghost { background: transparent; color: var(--ui-color-text-muted); }
.ui-btn--ghost:hover:not(:disabled) { background: var(--ui-color-surface-muted); color: var(--ui-color-text); }
.ui-btn--danger { background: var(--ui-color-danger); color: #fff; }
.ui-btn--danger:hover:not(:disabled) { background: var(--ui-color-danger-hover); }
.ui-btn--subtle { background: var(--ui-color-primary-soft); color: var(--ui-color-primary); }
.ui-btn--subtle:hover:not(:disabled) { background: #dbeafe; }
.ui-btn--sm { min-height: 30px; padding: 0 10px; font-size: 0.82rem; border-radius: var(--ui-radius-sm); }
.ui-btn--lg { min-height: 44px; padding: 0 20px; font-size: 1rem; }
.ui-btn--block { width: 100%; }
.ui-btn--icon { padding: 0; min-width: var(--ui-control-h); }

.ui-spinner {
  display: inline-block; width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: ui-spin .6s linear infinite;
}
.ui-spinner--lg { width: 28px; height: 28px; border-width: 3px; }
@keyframes ui-spin { to { transform: rotate(360deg); } }

/* ---------------------------------------------------------------- Inputs */
.ui-field { display: flex; flex-direction: column; gap: 6px; }
.ui-field__label { font-size: 0.85rem; font-weight: 600; color: var(--ui-color-text); }
.ui-field__req { color: var(--ui-color-danger); margin-left: 2px; }
.ui-field__hint { font-size: 0.78rem; color: var(--ui-color-text-muted); }
.ui-field__error { font-size: 0.78rem; color: var(--ui-color-danger); }

.ui-input, .ui-textarea, .ui-select {
  width: 100%;
  min-height: var(--ui-control-h);
  padding: 8px 12px;
  border: 1px solid var(--ui-color-border-strong);
  border-radius: var(--ui-radius-md);
  background: var(--ui-color-surface);
  color: var(--ui-color-text);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.ui-textarea { min-height: 84px; resize: vertical; }
.ui-select { appearance: none; padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8.5 1.5 4h9z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center;
}
.ui-input:hover, .ui-textarea:hover, .ui-select:hover { border-color: var(--ui-color-text-subtle); }
.ui-input:focus, .ui-textarea:focus, .ui-select:focus {
  outline: none; border-color: var(--ui-color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.ui-input--invalid, .ui-textarea--invalid, .ui-select--invalid { border-color: var(--ui-color-danger); }
.ui-input:disabled, .ui-select:disabled, .ui-textarea:disabled { background: var(--ui-color-surface-muted); opacity: .7; }

.ui-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem; }
.ui-checkbox input { width: 16px; height: 16px; accent-color: var(--ui-color-primary); }

/* ---------------------------------------------------------------- Cards */
.ui-card {
  background: var(--ui-color-surface);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-sm);
}
.ui-card__header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid var(--ui-color-border);
}
.ui-card__title { font-size: 1rem; font-weight: 650; margin: 0; }
.ui-card__subtitle { font-size: 0.82rem; color: var(--ui-color-text-muted); margin: 2px 0 0; }
.ui-card__body { padding: 20px; }
.ui-card__footer { padding: 14px 20px; border-top: 1px solid var(--ui-color-border); display: flex; gap: 8px; justify-content: flex-end; }

.ui-divider { height: 1px; background: var(--ui-color-border); border: 0; margin: 16px 0; }

/* ---------------------------------------------------------------- Badges */
.ui-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 9px; border-radius: var(--ui-radius-pill);
  font-size: 0.72rem; font-weight: 600; line-height: 1.6; white-space: nowrap;
  background: var(--ui-color-surface-muted); color: var(--ui-color-text-muted);
  border: 1px solid transparent;
}
.ui-badge--primary { background: var(--ui-color-primary-soft); color: var(--ui-color-primary); }
.ui-badge--success { background: var(--ui-color-success-soft); color: var(--ui-color-success); }
.ui-badge--danger { background: var(--ui-color-danger-soft); color: var(--ui-color-danger); }
.ui-badge--warning { background: var(--ui-color-warning-soft); color: var(--ui-color-warning); }
.ui-badge--info { background: var(--ui-color-info-soft); color: var(--ui-color-info); }

/* ---------------------------------------------------------------- Skeleton */
.ui-skeleton {
  display: block; border-radius: var(--ui-radius-sm);
  background: linear-gradient(90deg, #eef2f7 25%, #e2e8f0 37%, #eef2f7 63%);
  background-size: 400% 100%;
  animation: ui-skeleton 1.4s ease infinite;
}
@keyframes ui-skeleton { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton { animation: none; }
  .ui-spinner { animation-duration: 1.5s; }
  * { scroll-behavior: auto !important; }
}

/* ---------------------------------------------------------------- States */
.ui-state {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 8px; padding: 40px 20px; color: var(--ui-color-text-muted);
}
.ui-state__icon { font-size: 2rem; line-height: 1; }
.ui-state__title { font-size: 1rem; font-weight: 650; color: var(--ui-color-text); margin: 0; }
.ui-state__desc { font-size: 0.88rem; max-width: 420px; margin: 0; }
.ui-state--error .ui-state__title { color: var(--ui-color-danger); }

/* ---------------------------------------------------------------- Modal */
.ui-modal-backdrop {
  position: fixed; inset: 0; z-index: 1100; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: ui-fade .15s ease;
}
.ui-modal {
  width: min(560px, 100%); max-height: 90vh; overflow: auto;
  background: var(--ui-color-surface); border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-lg); animation: ui-pop .16s ease;
}
.ui-modal--sm { width: min(420px, 100%); }
.ui-modal--lg { width: min(760px, 100%); }
.ui-modal__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--ui-color-border); }
.ui-modal__title { font-size: 1.05rem; font-weight: 650; margin: 0; }
.ui-modal__close { background: transparent; border: 0; cursor: pointer; font-size: 1.3rem; line-height: 1; color: var(--ui-color-text-muted); border-radius: var(--ui-radius-sm); padding: 2px 6px; }
.ui-modal__close:hover { background: var(--ui-color-surface-muted); color: var(--ui-color-text); }
.ui-modal__body { padding: 20px; }
.ui-modal__footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--ui-color-border); }
@keyframes ui-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ui-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

/* ---------------------------------------------------------------- Toasts */
.ui-toast-region {
  position: fixed; top: 16px; right: 16px; z-index: 1300;
  display: flex; flex-direction: column; gap: 10px; width: min(380px, calc(100vw - 32px));
}
.ui-toast {
  display: flex; gap: 10px; align-items: flex-start;
  background: var(--ui-color-surface); border: 1px solid var(--ui-color-border);
  border-left: 4px solid var(--ui-color-text-subtle);
  border-radius: var(--ui-radius-md); padding: 12px 14px; box-shadow: var(--ui-shadow-md);
  animation: ui-slide .18s ease;
}
.ui-toast--success { border-left-color: var(--ui-color-success); }
.ui-toast--error { border-left-color: var(--ui-color-danger); }
.ui-toast--info { border-left-color: var(--ui-color-info); }
.ui-toast--warning { border-left-color: var(--ui-color-warning); }
.ui-toast__title { font-weight: 650; font-size: 0.9rem; }
.ui-toast__desc { font-size: 0.82rem; color: var(--ui-color-text-muted); margin-top: 2px; }
.ui-toast__close { margin-left: auto; background: transparent; border: 0; cursor: pointer; color: var(--ui-color-text-subtle); font-size: 1.1rem; line-height: 1; }
@keyframes ui-slide { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }

/* ---------------------------------------------------------------- Breadcrumbs */
.ui-breadcrumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 0.82rem; color: var(--ui-color-text-muted); list-style: none; margin: 0; padding: 0; }
.ui-breadcrumbs li { display: inline-flex; align-items: center; gap: 6px; }
.ui-breadcrumbs__sep { color: var(--ui-color-text-subtle); }
.ui-breadcrumbs a { color: var(--ui-color-text-muted); }
.ui-breadcrumbs a:hover { color: var(--ui-color-primary); }
.ui-breadcrumbs [aria-current='page'] { color: var(--ui-color-text); font-weight: 600; }

/* ---------------------------------------------------------------- Page header */
.ui-page-header { display: flex; flex-direction: column; gap: 12px; }
.ui-page-header__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ui-page-header__title { font-size: 1.35rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.ui-page-header__desc { font-size: 0.88rem; color: var(--ui-color-text-muted); margin: 2px 0 0; }
.ui-page-header__actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---------------------------------------------------------------- Tabs */
.ui-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--ui-color-border); overflow-x: auto; }
.ui-tab {
  border: 0; background: transparent; cursor: pointer; padding: 10px 14px;
  font-size: 0.9rem; font-weight: 600; color: var(--ui-color-text-muted);
  border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;
}
.ui-tab:hover { color: var(--ui-color-text); }
.ui-tab[aria-selected='true'] { color: var(--ui-color-primary); border-bottom-color: var(--ui-color-primary); }

/* ---------------------------------------------------------------- Toolbar + tables */
.ui-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 14px; }
.ui-toolbar__grow { flex: 1 1 220px; min-width: 180px; }
.ui-toolbar__spacer { flex: 1 1 auto; }

.ui-bulkbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  background: var(--ui-color-primary-soft); border: 1px solid #bfdbfe;
  border-radius: var(--ui-radius-md); padding: 8px 12px; margin-bottom: 12px; font-size: 0.86rem;
}
.ui-bulkbar strong { color: var(--ui-color-primary); }

.ui-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--ui-color-border); border-radius: var(--ui-radius-md); }
.ui-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.ui-table thead th {
  text-align: left; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ui-color-text-muted); font-weight: 700; padding: 10px 12px;
  background: var(--ui-color-surface-muted); border-bottom: 1px solid var(--ui-color-border);
  white-space: nowrap;
}
.ui-table tbody td { padding: 11px 12px; border-bottom: 1px solid var(--ui-color-border); vertical-align: middle; }
.ui-table tbody tr:last-child td { border-bottom: 0; }
.ui-table tbody tr:hover { background: var(--ui-color-surface-muted); }
.ui-table tbody tr[data-clickable='true'] { cursor: pointer; }
.ui-table tbody tr[data-selected='true'] { background: var(--ui-color-primary-soft); }
.ui-table .ui-table__num { text-align: right; font-variant-numeric: tabular-nums; }
.ui-table .ui-table__center { text-align: center; }
.ui-table__sort { cursor: pointer; user-select: none; }
.ui-table__sort:hover { color: var(--ui-color-text); }
.ui-table__sort-ind { margin-left: 4px; color: var(--ui-color-text-subtle); }
.ui-table__actions { display: flex; gap: 6px; justify-content: flex-end; }

@media (max-width: 640px) {
  .ui-table--responsive thead { display: none; }
  .ui-table--responsive tbody td {
    display: flex; justify-content: space-between; gap: 12px; text-align: right;
    padding: 8px 12px; border-bottom: 1px solid var(--ui-color-border);
  }
  .ui-table--responsive tbody td::before {
    content: attr(data-label); font-weight: 600; color: var(--ui-color-text-muted);
    text-align: left; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .ui-table--responsive tbody tr { display: block; border-bottom: 8px solid var(--ui-color-surface-muted); }
  .ui-table--responsive tbody td:last-child { border-bottom: 0; }
}

/* ---------------------------------------------------------------- Pagination */
.ui-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.ui-pagination__info { font-size: 0.82rem; color: var(--ui-color-text-muted); }
.ui-pagination__controls { display: flex; gap: 6px; align-items: center; }

/* ---------------------------------------------------------------- Stats */
.ui-stat { display: flex; flex-direction: column; gap: 4px; }
.ui-stat__label { font-size: 0.78rem; font-weight: 600; color: var(--ui-color-text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.ui-stat__value { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; }
.ui-stat__hint { font-size: 0.78rem; color: var(--ui-color-text-muted); }
`;

/**
 * Injects {@link globalStyles} once. Mount at the app root (main.tsx). Safe to render multiple
 * times: the stylesheet is keyed by id so subsequent mounts are no-ops.
 */
export function GlobalStyles(): React.ReactElement | null {
  React.useEffect(() => {
    if (document.getElementById(GLOBAL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = GLOBAL_STYLE_ID;
    style.textContent = globalStyles;
    document.head.appendChild(style);
  }, []);
  return null;
}

/** Tiny class-name joiner (dependency-free `clsx`). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
