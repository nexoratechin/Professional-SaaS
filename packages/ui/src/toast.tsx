import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './theme';

export type ToastVariant = 'neutral' | 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. 0 keeps the toast until dismissed. Default 5000. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'variant' | 'duration'>> {
  id: string;
  description?: string;
}

interface ToastApi {
  push: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastApi | null>(null);

let toastSeq = 0;

/**
 * App-wide toast notifications. Mount once near the root; call `useToast()` anywhere below it.
 * Renders an aria-live region so screen readers announce transient results (saves, deletes, errors)
 * that would otherwise be silent.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${++toastSeq}`;
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? 'neutral',
        duration: options.duration ?? 5000,
      };
      setToasts((prev) => [...prev, item]);
      if (item.duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), item.duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error', duration: 7000 }),
      info: (title, description) => push({ title, description, variant: 'info' }),
      warning: (title, description) => push({ title, description, variant: 'warning' }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" role="region" aria-label="Notifications">
        <div aria-live="polite" aria-atomic="false" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {toasts.map((toast) => (
            <div key={toast.id} className={cx('ui-toast', toast.variant !== 'neutral' && `ui-toast--${toast.variant}`)} role="status">
              <div style={{ minWidth: 0 }}>
                <div className="ui-toast__title">{toast.title}</div>
                {toast.description && <div className="ui-toast__desc">{toast.description}</div>}
              </div>
              <button type="button" className="ui-toast__close" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
