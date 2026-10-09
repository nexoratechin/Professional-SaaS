/**
 * Identifier + connection-URL helpers for enterprise tenant stores.
 *
 * Postgres identifiers (schema/database names) are derived from a tenant slug, so they must be
 * validated against a strict allow-list before ever being interpolated into DDL, and quoted when
 * used. Connection URLs are manipulated with the WHATWG URL parser rather than string surgery so
 * credentials, query parameters and the port survive intact.
 */

/** Derived/entered schema names: lowercase, digits and underscores, must start with a letter. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export class InvalidTenantDatabaseIdentifierError extends Error {
  constructor(kind: 'schema' | 'database', value: string) {
    super(`Invalid ${kind} name "${value}": expected /^[a-z][a-z0-9_]{0,62}$/.`);
    this.name = 'InvalidTenantDatabaseIdentifierError';
  }
}

export function assertValidSchemaName(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new InvalidTenantDatabaseIdentifierError('schema', name);
  }
  return name;
}

export function assertValidDatabaseName(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new InvalidTenantDatabaseIdentifierError('database', name);
  }
  return name;
}

/** Turns a tenant slug into a safe identifier fragment (`acme-college` -> `acme_college`). */
export function slugToIdentifier(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function deriveSchemaName(prefix: string, slug: string): string {
  return assertValidSchemaName(`${prefix}${slugToIdentifier(slug)}`);
}

export function deriveDatabaseName(prefix: string, slug: string): string {
  return assertValidDatabaseName(`${prefix}${slugToIdentifier(slug)}`);
}

/** Quotes a validated identifier for interpolation into DDL. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`Malformed connection URL: "${url}"`);
  }
}

/** Returns the same URL with `?schema=<schema>` set (used by DEDICATED_SCHEMA). */
export function withSchemaParam(url: string, schema: string): string {
  assertValidSchemaName(schema);
  const parsed = parse(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

/** Returns the same URL pointed at a different database (used by DEDICATED_DATABASE). */
export function withDatabaseName(url: string, databaseName: string): string {
  assertValidDatabaseName(databaseName);
  const parsed = parse(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export function databaseNameFromUrl(url: string): string {
  const parsed = parse(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}
