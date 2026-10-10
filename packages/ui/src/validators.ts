/** A validator returns an error message, or null when the value is acceptable. */
export type Validator = (value: string) => string | null;

export function required(message = 'This field is required'): Validator {
  return (value) => (value == null || String(value).trim() === '' ? message : null);
}

export function email(message = 'Enter a valid email address'): Validator {
  return (value) => {
    if (!value) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : message;
  };
}

export function minLength(length: number, message?: string): Validator {
  return (value) => (value && value.length < length ? message ?? `Must be at least ${length} characters` : null);
}

export function maxLength(length: number, message?: string): Validator {
  return (value) => (value && value.length > length ? message ?? `Must be at most ${length} characters` : null);
}

export function pattern(regex: RegExp, message = 'Invalid format'): Validator {
  return (value) => (value && !regex.test(value) ? message : null);
}

export function numeric(message = 'Enter a number'): Validator {
  return (value) => (value && Number.isNaN(Number(value)) ? message : null);
}

/** Runs validators in order and returns the first error (or null). */
export function runValidators(value: string, validators: Validator[]): string | null {
  for (const validator of validators) {
    const error = validator(value);
    if (error) return error;
  }
  return null;
}

export type FieldRules<T extends string = string> = Partial<Record<T, Validator[]>>;
export type FieldErrors<T extends string = string> = Partial<Record<T, string>>;

/**
 * Validates a flat record of string form values against per-field rule lists.
 * Returns a map of only the failing fields — `Object.keys(errors).length === 0` means valid.
 */
export function validateFields<T extends string>(
  values: Record<T, string>,
  rules: FieldRules<T>,
): FieldErrors<T> {
  const errors: FieldErrors<T> = {};
  (Object.keys(rules) as T[]).forEach((field) => {
    const validators = rules[field];
    if (!validators) return;
    const error = runValidators(values[field] ?? '', validators);
    if (error) errors[field] = error;
  });
  return errors;
}
