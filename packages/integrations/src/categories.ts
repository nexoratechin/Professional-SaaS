/**
 * Integration categories, capabilities and the config/credential contract each one declares.
 *
 * ## Why a closed category list
 *
 * `IntegrationCategory` is closed on purpose. The alternative — a free-form string — makes three
 * things impossible at runtime: which fields a form should render, whether a webhook may be
 * registered for this connection, and whether a synchronization direction is meaningful. Keeping
 * it closed costs almost nothing (a new *kind* of system is a rare, deliberate migration) and buys
 * a framework that can validate configuration without knowing any vendor.
 *
 * ## Why `provider` is separate from `category`
 *
 * `category` answers "what is this system", `provider` answers "which adapter speaks to it".
 * Confusing the two is what couples an ERP to one vendor: a category that enumerated
 * `STRIPE`/`RAZORPAY`/`PAYTM` would need a schema change per vendor. Here `PROVIDERS_BY_CATEGORY`
 * maps every category onto the SAME adapter keys (`http_json`, `webhook`, `mock`), so a new vendor
 * is configuration, never a migration. `registerIntegrationAdapter()` can add a bespoke adapter at
 * runtime for the rare system that is not a plain JSON-over-HTTP API (see registry.ts).
 *
 * This mirrors `PROVIDERS_BY_CHANNEL` in @college-erp/notifications — same idea, one level up.
 */

export const INTEGRATION_CATEGORIES = [
  'PAYMENT_GATEWAY',
  'ACCOUNTING',
  'LMS',
  'BIOMETRIC',
  'RFID',
  'IDENTITY_PROVIDER',
  'DOCUMENT_SERVICE',
  'SMS',
  'WHATSAPP',
  'EMAIL',
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

/** Human labels for the UI. Kept beside the taxonomy so a new category cannot ship unlabelled. */
export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  PAYMENT_GATEWAY: 'Payment gateway',
  ACCOUNTING: 'Accounting system',
  LMS: 'Learning management (LMS)',
  BIOMETRIC: 'Biometric system',
  RFID: 'RFID system',
  IDENTITY_PROVIDER: 'Identity provider (SSO)',
  DOCUMENT_SERVICE: 'Document / e-signature service',
  SMS: 'SMS gateway',
  WHATSAPP: 'WhatsApp gateway',
  EMAIL: 'Email service',
};

/** Adapter keys shipped by this package. Any other key must be registered at runtime. */
export const INTEGRATION_PROVIDERS = ['http_json', 'webhook', 'mock'] as const;
export type BuiltInIntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Which adapter keys each category accepts.
 *
 * Every category accepts the same three built-ins, which is precisely the point: the category
 * describes the *business* role of the connection and the provider describes the *wire protocol*,
 * so no module ever needs to know that (say) an SMS gateway and an accounting export both happen
 * to be JSON-over-HTTP. `webhook` is meaningful for any category because inbound callbacks are
 * orthogonal to what the system is.
 */
export const PROVIDERS_BY_CATEGORY: Record<IntegrationCategory, readonly string[]> = {
  PAYMENT_GATEWAY: ['http_json', 'webhook', 'mock'],
  ACCOUNTING: ['http_json', 'webhook', 'mock'],
  LMS: ['http_json', 'webhook', 'mock'],
  BIOMETRIC: ['http_json', 'webhook', 'mock'],
  RFID: ['http_json', 'webhook', 'mock'],
  IDENTITY_PROVIDER: ['http_json', 'webhook', 'mock'],
  DOCUMENT_SERVICE: ['http_json', 'webhook', 'mock'],
  SMS: ['http_json', 'webhook', 'mock'],
  WHATSAPP: ['http_json', 'webhook', 'mock'],
  EMAIL: ['http_json', 'webhook', 'mock'],
};

/**
 * Lifecycle states an integration can be in. Mirrors the Prisma `IntegrationStatus` enum so the
 * DTOs can validate against one shared const without importing Prisma.
 */
export const INTEGRATION_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_DIRECTIONS = ['OUTBOUND', 'INBOUND', 'BIDIRECTIONAL'] as const;
export type IntegrationDirection = (typeof INTEGRATION_DIRECTIONS)[number];

/**
 * A synchronization run's mode. Mirrors the PULL_SYNC / PUSH_SYNC capability names so a mode can be
 * checked against `categorySupports(category, mode)` without a mapping table — one vocabulary for
 * "what can this connection do" across the catalog, the DTOs, the queue payload and the run loop.
 */
export const SYNC_MODES = ['PULL_SYNC', 'PUSH_SYNC'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export function isKnownCategory(category: string): category is IntegrationCategory {
  return (INTEGRATION_CATEGORIES as readonly string[]).includes(category);
}

export function isKnownProvider(category: IntegrationCategory, provider: string): boolean {
  return PROVIDERS_BY_CATEGORY[category].includes(provider);
}

export function integrationProvidersFor(category: string): readonly string[] {
  return isKnownCategory(category) ? PROVIDERS_BY_CATEGORY[category] : [];
}

// ── Capabilities ───────────────────────────────────────────────────────────────

/**
 * What a connection can be used for. Declared per category (not per integration) so callers can
 * ask "does anything here support webhooks?" before any integration is configured, and so the UI
 * can disable controls that cannot work.
 */
export const INTEGRATION_CAPABILITIES = [
  /** The ERP sends requests out and the provider returns a response (payment create, SMS send…). */
  'OUTBOUND_CALL',
  /** The provider posts events in through a webhook endpoint this platform hosts. */
  'INBOUND_WEBHOOK',
  /** The ERP can pull a batch of remote records and reconcile them (vendor/GL/student export). */
  'PULL_SYNC',
  /** The ERP can push local records to the provider. */
  'PUSH_SYNC',
  /** The connection can be probed with `testConnection`. */
  'CONNECTION_TEST',
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const CAPABILITIES_BY_CATEGORY: Record<IntegrationCategory, readonly IntegrationCapability[]> = {
  PAYMENT_GATEWAY: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PULL_SYNC', 'PUSH_SYNC', 'CONNECTION_TEST'],
  ACCOUNTING: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PULL_SYNC', 'PUSH_SYNC', 'CONNECTION_TEST'],
  LMS: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PULL_SYNC', 'PUSH_SYNC', 'CONNECTION_TEST'],
  BIOMETRIC: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PULL_SYNC', 'PUSH_SYNC', 'CONNECTION_TEST'],
  RFID: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PULL_SYNC', 'PUSH_SYNC', 'CONNECTION_TEST'],
  IDENTITY_PROVIDER: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'CONNECTION_TEST'],
  // Document/e-signature services are almost always push + callback driven; pulling a remote
  // document archive back into the ERP is possible but is not a first-class flow, so PULL_SYNC is
  // deliberately absent — the UI will not offer a "pull" sync for this category.
  DOCUMENT_SERVICE: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'PUSH_SYNC', 'CONNECTION_TEST'],
  SMS: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'CONNECTION_TEST'],
  WHATSAPP: ['OUTBOUND_CALL', 'INBOUND_WEBHOOK', 'CONNECTION_TEST'],
  EMAIL: ['OUTBOUND_CALL', 'CONNECTION_TEST'],
};

export function categorySupports(category: string, capability: IntegrationCapability): boolean {
  return isKnownCategory(category) && CAPABILITIES_BY_CATEGORY[category].includes(capability);
}

// ── Config / credential contract ───────────────────────────────────────────────

/** How the outbound adapter authenticates. Determines which credential keys are required. */
export const AUTH_STYLES = ['none', 'bearer', 'api_key_header', 'basic', 'query'] as const;
export type AuthStyle = (typeof AUTH_STYLES)[number];

export interface ConfigFieldSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'enum';
  required: boolean;
  /** Allowed values when type is 'enum'. */
  options?: readonly string[];
  /** Marks the field as holding a secret; such fields belong in `credentials`, not `config`. */
  secret?: boolean;
  help?: string;
}

/**
 * The non-secret settings an adapter understands. Deliberately flat and JSON-shaped: the API
 * stores them verbatim, the UI renders them from this spec, and `http_json` reads a documented
 * subset. A vendor needing something extra uses `extra` below rather than a new column.
 */
export const BASE_CONFIG_FIELDS: readonly ConfigFieldSpec[] = [
  { key: 'baseUrl', label: 'Base URL', type: 'string', required: true, help: 'e.g. https://api.vendor.com/v1' },
  { key: 'authStyle', label: 'Auth style', type: 'enum', required: true, options: AUTH_STYLES },
  { key: 'timeoutSec', label: 'Timeout (seconds)', type: 'number', required: false },
  { key: 'headers', label: 'Extra headers', type: 'json', required: false, help: 'Object of static header name → value.' },
  { key: 'verifyTls', label: 'Verify TLS', type: 'boolean', required: false, help: 'Disable only for self-signed test gateways.' },
];

/**
 * The secret keys each auth style needs. Validated on save so a tenant cannot activate an
 * integration that is guaranteed to fail with 401, and so `testConnection` can report a precise
 * "missing credential: apiKey" instead of a generic auth error.
 */
export const CREDENTIAL_KEYS_BY_AUTH_STYLE: Record<AuthStyle, readonly string[]> = {
  none: [],
  bearer: ['token'],
  api_key_header: ['apiKey'],
  basic: ['username', 'password'],
  query: ['apiKey'],
};

/** Extra config keys `http_json` understands for shaping requests. */
export const HTTP_JSON_EXTRA_CONFIG_FIELDS: readonly ConfigFieldSpec[] = [
  { key: 'testPath', label: 'Test path', type: 'string', required: false, help: 'Path appended to baseUrl by "Test connection". Defaults to /.' },
  { key: 'testMethod', label: 'Test method', type: 'enum', required: false, options: ['GET', 'HEAD', 'POST'] },
  { key: 'apiKeyHeader', label: 'API key header', type: 'string', required: false, help: 'Header name for api_key_header auth.' },
  { key: 'idempotencyHeader', label: 'Idempotency header', type: 'string', required: false, help: 'Header carrying the operation idempotency key.' },
];

/** Thrown when a tenant's configuration could never work. Carries a human-readable reason. */
export class IntegrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationConfigError';
  }
}

export interface IntegrationConfigInput {
  category: string;
  provider: string;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
  /** Registered-but-unshipped provider keys are accepted; unknown categories/providers are not. */
  isProviderRegistered?: boolean;
}

/**
 * Validates a configuration before it is persisted. Runs on create, update and activation, so an
 * unusable integration can never reach ACTIVE and start failing traffic in production.
 *
 * Ordering is deliberate: category, then provider, then per-provider requirements. Reporting
 * "unknown category" before "missing baseUrl" keeps the message actionable.
 */
export function assertValidIntegrationConfig(input: IntegrationConfigInput): void {
  if (!isKnownCategory(input.category)) {
    throw new IntegrationConfigError(`Unknown integration category "${input.category}".`);
  }
  const category = input.category;

  if (!isKnownProvider(category, input.provider) && input.isProviderRegistered !== true) {
    throw new IntegrationConfigError(
      `Provider "${input.provider}" is not available for category ${category}. ` +
        `Supported: ${PROVIDERS_BY_CATEGORY[category].join(', ')}, or a runtime-registered adapter.`,
    );
  }

  const config = input.config ?? {};
  const credentials = input.credentials ?? {};

  // `webhook` and `mock` are inbound/dev adapters: they make no outbound request, so demanding a
  // baseUrl would reject perfectly valid inbound-only configurations.
  const requiresOutbound = input.provider !== 'webhook';
  if (requiresOutbound) {
    const baseUrl = config.baseUrl;
    if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
      throw new IntegrationConfigError(`"baseUrl" is required for provider "${input.provider}".`);
    }
    let parsed: URL;
    try {
      parsed = new URL(baseUrl.trim());
    } catch {
      throw new IntegrationConfigError(`"baseUrl" is not a valid URL: ${baseUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new IntegrationConfigError('"baseUrl" must use http or https.');
    }
  }

  const authStyle = (typeof config.authStyle === 'string' ? config.authStyle : 'bearer') as AuthStyle;
  if (!(AUTH_STYLES as readonly string[]).includes(authStyle)) {
    throw new IntegrationConfigError(
      `Unknown authStyle "${authStyle}". Supported: ${AUTH_STYLES.join(', ')}.`,
    );
  }

  const requiredCredentialKeys = CREDENTIAL_KEYS_BY_AUTH_STYLE[authStyle];
  const missing: string[] = [];
  for (const key of requiredCredentialKeys) {
    const value = credentials[key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new IntegrationConfigError(
      `Credentials missing for authStyle "${authStyle}": ${missing.join(', ')}.`,
    );
  }

  if (input.provider === 'mock' && credentials.token === undefined && config.requireMockToken === true) {
    throw new IntegrationConfigError('The mock provider was configured to require a token, but none was supplied.');
  }
}

/**
 * The credential KEY names a tenant has already stored, never their values. This is what lets a
 * settings form render "•••• configured" without the API ever decrypting a secret to display it.
 */
export function credentialKeys(credentials: Record<string, unknown> | null | undefined): string[] {
  if (!credentials) return [];
  return Object.keys(credentials)
    .filter((key) => {
      const value = credentials[key];
      return typeof value === 'string' && value !== '';
    })
    .sort();
}

/** Full field spec for a category+provider, so the UI can render a correct form without guessing. */
export function configFieldsFor(category: string, provider: string): ConfigFieldSpec[] {
  const fields: ConfigFieldSpec[] = [...BASE_CONFIG_FIELDS];
  if (provider === 'http_json') {
    fields.push(...HTTP_JSON_EXTRA_CONFIG_FIELDS);
  }
  if (!categorySupports(category, 'INBOUND_WEBHOOK')) {
    // Nothing to do — kept as an explicit branch so a future category with no webhook support has
    // an obvious place to advertise why.
    return fields;
  }
  return fields;
}
