import React, { forwardRef, useId } from 'react';
import { cx } from './theme';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Marks the label with a required asterisk (also pass `required` to the input for a11y). */
  requiredMark?: boolean;
}

/**
 * Text input with an integrated field label, hint and inline error. Backwards compatible with the
 * original `label` prop; `error`/`hint` add accessible validation messaging via aria attributes.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, requiredMark, id, className, style, required, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? props.name ?? autoId;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean).join(' ') || undefined;
  const showMark = requiredMark ?? required;

  return (
    <div className="ui-field">
      {label && (
        <label className="ui-field__label" htmlFor={inputId}>
          {label}
          {showMark && <span className="ui-field__req" aria-hidden="true">*</span>}
        </label>
      )}
      <input
        {...props}
        id={inputId}
        ref={ref}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx('ui-input', error && 'ui-input--invalid', className)}
        style={style}
      />
      {hint && !error && <span className="ui-field__hint" id={`${inputId}-hint`}>{hint}</span>}
      {error && <span className="ui-field__error" id={`${inputId}-error`} role="alert">{error}</span>}
    </div>
  );
});
