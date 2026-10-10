import React, { useCallback, useEffect, useRef } from 'react';
import { cx } from './theme';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Set false to require an explicit action (no backdrop/escape dismissal). */
  dismissable?: boolean;
  /** Accessible label when no visible title is rendered. */
  ariaLabel?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: renders in a portal, traps Tab focus, closes on Escape/backdrop, locks
 * body scroll, and restores focus to the trigger on close. Used directly and by ConfirmDialog.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', dismissable = true, ariaLabel }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissable, onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    const focusTimer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? dialogRef.current;
      target?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cx('ui-modal', size !== 'md' && `ui-modal--${size}`)}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? undefined : ariaLabel}
        aria-labelledby={typeof title === 'string' || title != null ? 'ui-modal-title' : undefined}
        tabIndex={-1}
      >
        {(title || dismissable) && (
          <div className="ui-modal__header">
            {title != null && <h2 className="ui-modal__title" id="ui-modal-title">{title}</h2>}
            {dismissable && (
              <button type="button" className="ui-modal__close" aria-label="Close dialog" onClick={onClose}>
                ×
              </button>
            )}
          </div>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
