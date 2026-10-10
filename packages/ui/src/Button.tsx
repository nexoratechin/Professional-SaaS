import React from 'react';
import { cx } from './theme';
import { Spinner } from './feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and block interaction while true. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  /** Leading adornment (icon element). */
  iconLeft?: React.ReactNode;
}

/**
 * The design-system button. Backwards compatible with the original
 * `variant="primary" | "secondary"` API, extended with sizes, loading and icon slots. All visual
 * styling lives in the global stylesheet so hover/focus/disabled states stay consistent.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  iconLeft,
  className,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`, block && 'ui-btn--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
    </button>
  );
}
