import React, { forwardRef, useId } from 'react';
import { cx } from './theme';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  requiredMark?: boolean;
}

/** Native select styled to match the design system. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, requiredMark, id, className, children, required, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? props.name ?? autoId;
  const describedBy = [error ? `${selectId}-error` : null, hint ? `${selectId}-hint` : null].filter(Boolean).join(' ') || undefined;
  const showMark = requiredMark ?? required;
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-field__label" htmlFor={selectId}>
          {label}
          {showMark && <span className="ui-field__req" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        {...props}
        id={selectId}
        ref={ref}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx('ui-select', error && 'ui-select--invalid', className)}
      >
        {children}
      </select>
      {hint && !error && <span className="ui-field__hint" id={`${selectId}-hint`}>{hint}</span>}
      {error && <span className="ui-field__error" id={`${selectId}-error`} role="alert">{error}</span>}
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  requiredMark?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, requiredMark, id, className, required, ...props },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? props.name ?? autoId;
  const describedBy = [error ? `${areaId}-error` : null, hint ? `${areaId}-hint` : null].filter(Boolean).join(' ') || undefined;
  const showMark = requiredMark ?? required;
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-field__label" htmlFor={areaId}>
          {label}
          {showMark && <span className="ui-field__req" aria-hidden="true">*</span>}
        </label>
      )}
      <textarea
        {...props}
        id={areaId}
        ref={ref}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx('ui-textarea', error && 'ui-textarea--invalid', className)}
      />
      {hint && !error && <span className="ui-field__hint" id={`${areaId}-hint`}>{hint}</span>}
      {error && <span className="ui-field__error" id={`${areaId}-error`} role="alert">{error}</span>}
    </div>
  );
});

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...props }, ref) {
  return (
    <label className="ui-checkbox">
      <input {...props} ref={ref} type="checkbox" className={className} />
      {label && <span>{label}</span>}
    </label>
  );
});
