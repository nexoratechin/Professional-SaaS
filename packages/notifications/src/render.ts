/**
 * Template rendering for notifications — the one interpolation implementation shared by the API
 * (renders templates into the stored Notification subject/body at enqueue time, and previews) and
 * any consumer that needs to know which variables a template declares.
 *
 * Syntax is `{{variableName}}` (whitespace around the name tolerated). Variable names may contain
 * letters, digits, dots and underscores so nested access patterns like `{{student.fullName}}` map
 * 1:1 onto a flat variables bag keyed `"student.fullName"`.
 */

export type TemplateVariableValue = string | number | boolean | null | undefined;

export type TemplateVariables = Record<string, TemplateVariableValue>;

export interface RenderedTemplate {
  text: string;
  /** Variables referenced by the template that had no value in the supplied bag. Kept as-is in
   * the output (`{{name}}` left intact) so a missing value is loud, never silently blank. */
  missingVariables: string[];
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function renderTemplate(template: string, variables: TemplateVariables = {}): RenderedTemplate {
  const missingVariables = new Set<string>();
  const text = template.replace(VARIABLE_PATTERN, (match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      missingVariables.add(key);
      return match;
    }
    return String(value);
  });
  return { text, missingVariables: [...missingVariables] };
}

/** Declared variables in a template, in first-appearance order (deduplicated). */
export function extractTemplateVariables(template: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const key = match[1];
    if (key !== undefined && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}