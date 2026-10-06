import {
  assertValidIntegrationConfig,
  AUTH_STYLES,
  categorySupports,
  configFieldsFor,
  credentialKeys,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  integrationProvidersFor,
  isKnownCategory,
  isKnownProvider,
  INTEGRATION_CAPABILITIES,
  PROVIDERS_BY_CATEGORY,
} from './categories';

const HTTP_JSON_CONFIG = { baseUrl: 'https://api.vendor.test/v1', authStyle: 'bearer' };
const BEARER = { token: 'sk_test_123' };

function input(overrides: Partial<Parameters<typeof assertValidIntegrationConfig>[0]> = {}) {
  return {
    category: 'PAYMENT_GATEWAY',
    provider: 'http_json',
    config: { ...HTTP_JSON_CONFIG },
    credentials: { ...BEARER },
    ...overrides,
  } as Parameters<typeof assertValidIntegrationConfig>[0];
}

describe('category taxonomy', () => {
  it('has a label for every category (an unlabelled category could not ship in the UI)', () => {
    for (const category of INTEGRATION_CATEGORIES) {
      expect(INTEGRATION_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('has no duplicate category values', () => {
    expect(new Set(INTEGRATION_CATEGORIES).size).toBe(INTEGRATION_CATEGORIES.length);
  });

  it('offers the same built-in adapter set for every category, which is what keeps it vendor-neutral', () => {
    const shapes = new Set(INTEGRATION_CATEGORIES.map((category) => PROVIDERS_BY_CATEGORY[category].join(',')));
    expect(shapes.size).toBe(1);
  });

  it('covers all nine requested integration kinds', () => {
    for (const required of [
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
    ]) {
      expect(INTEGRATION_CATEGORIES).toContain(required);
    }
  });

  it('has no duplicate capability values', () => {
    expect(new Set(INTEGRATION_CAPABILITIES).size).toBe(INTEGRATION_CAPABILITIES.length);
  });

  it('recognises known and unknown categories', () => {
    expect(isKnownCategory('LMS')).toBe(true);
    expect(isKnownCategory('TELEPATHY')).toBe(false);
  });

  it('validates provider/category pairing', () => {
    expect(isKnownProvider('SMS', 'http_json')).toBe(true);
    expect(integrationProvidersFor('nope')).toEqual([]);
  });

  it('gates capabilities per category', () => {
    expect(categorySupports('EMAIL', 'INBOUND_WEBHOOK')).toBe(false);
    expect(categorySupports('EMAIL', 'OUTBOUND_CALL')).toBe(true);
    expect(categorySupports('PAYMENT_GATEWAY', 'PULL_SYNC')).toBe(true);
    expect(categorySupports('NOT_A_CATEGORY', 'OUTBOUND_CALL')).toBe(false);
  });

  it('exposes http_json-specific config fields only for the http_json provider', () => {
    const httpKeys = configFieldsFor('SMS', 'http_json').map((field) => field.key);
    const mockKeys = configFieldsFor('SMS', 'mock').map((field) => field.key);
    expect(httpKeys).toContain('testPath');
    expect(httpKeys).toContain('apiKeyHeader');
    expect(mockKeys).not.toContain('apiKeyHeader');
  });

  it('marks baseUrl required in the rendered field spec', () => {
    const baseUrl = configFieldsFor('ACCOUNTING', 'http_json').find((field) => field.key === 'baseUrl');
    expect(baseUrl?.required).toBe(true);
  });

  it('offers every auth style in the field spec', () => {
    const authStyle = configFieldsFor('SMS', 'http_json').find((field) => field.key === 'authStyle');
    expect(authStyle?.options).toEqual(AUTH_STYLES);
  });
});

describe('assertValidIntegrationConfig', () => {
  it('accepts a well-formed configuration', () => {
    expect(() => assertValidIntegrationConfig(input())).not.toThrow();
  });

  it('rejects an unknown category before anything else', () => {
    expect(() => assertValidIntegrationConfig(input({ category: 'TELEPATHY' }))).toThrow(/Unknown integration category/);
  });

  it('rejects an unknown provider and lists what is supported', () => {
    expect(() => assertValidIntegrationConfig(input({ provider: 'stripe_sdk' }))).toThrow(/not available/);
  });

  it('accepts a runtime-registered provider the package does not ship', () => {
    expect(() => assertValidIntegrationConfig(input({ provider: 'acme_sftp', isProviderRegistered: true }))).not.toThrow();
  });

  it('requires baseUrl for providers that make outbound calls', () => {
    expect(() => assertValidIntegrationConfig(input({ config: { authStyle: 'bearer' } }))).toThrow(/"baseUrl" is required/);
  });

  it('does not require baseUrl for the inbound-only webhook provider', () => {
    expect(() =>
      assertValidIntegrationConfig(input({ provider: 'webhook', config: { authStyle: 'none' }, credentials: {} })),
    ).not.toThrow();
  });

  it('rejects a malformed baseUrl and a non-http scheme', () => {
    expect(() => assertValidIntegrationConfig(input({ config: { ...HTTP_JSON_CONFIG, baseUrl: 'not a url' } }))).toThrow(
      /not a valid URL/,
    );
    expect(() =>
      assertValidIntegrationConfig(input({ config: { ...HTTP_JSON_CONFIG, baseUrl: 'ftp://vendor.test' } })),
    ).toThrow(/http or https/);
  });

  it('rejects an unknown authStyle', () => {
    expect(() => assertValidIntegrationConfig(input({ config: { ...HTTP_JSON_CONFIG, authStyle: 'oauth_ish' } }))).toThrow(
      /Unknown authStyle/,
    );
  });

  it('requires the credentials each auth style needs, naming the missing keys', () => {
    expect(() => assertValidIntegrationConfig(input({ credentials: {} }))).toThrow(/Credentials missing.*token/);
    expect(() =>
      assertValidIntegrationConfig(input({ config: { ...HTTP_JSON_CONFIG, authStyle: 'api_key_header' }, credentials: {} })),
    ).toThrow(/apiKey/);
    expect(() =>
      assertValidIntegrationConfig(
        input({ config: { ...HTTP_JSON_CONFIG, authStyle: 'basic' }, credentials: { username: 'u' } }),
      ),
    ).toThrow(/password/);
  });

  it('requires no credentials for authStyle=none', () => {
    expect(() =>
      assertValidIntegrationConfig(input({ config: { ...HTTP_JSON_CONFIG, authStyle: 'none' }, credentials: {} })),
    ).not.toThrow();
  });

  it('rejects a whitespace-only credential', () => {
    expect(() => assertValidIntegrationConfig(input({ credentials: { token: '   ' } }))).toThrow(/Credentials missing/);
  });

  it('tolerates a missing config/credentials object rather than throwing a TypeError', () => {
    expect(() =>
      assertValidIntegrationConfig({
        category: 'WEBHOOKISH' as never,
        provider: 'webhook',
        config: undefined as never,
        credentials: undefined as never,
      }),
    ).toThrow(/Unknown integration category/);
  });
});

describe('credentialKeys', () => {
  it('lists configured key names, never values, so a form can show "configured" safely', () => {
    const keys = credentialKeys({ apiKey: 'sk_live_secret', username: 'acme', blank: '', notAString: 5 });
    expect(keys).toEqual(['apiKey', 'username']);
  });

  it('returns an empty list for absent credentials', () => {
    expect(credentialKeys(null)).toEqual([]);
    expect(credentialKeys(undefined)).toEqual([]);
    expect(credentialKeys({})).toEqual([]);
  });
});
