/**
 * Integration adapter registry — the vendor-neutral seam, and the only place that maps a stored
 * `Integration.provider` string onto executable code.
 *
 * ## How a new vendor is added
 *
 * - **JSON-over-HTTP vendor (the overwhelming majority):** nothing. Configure
 *   `provider: 'http_json'` with a baseUrl, auth style and per-operation paths. No code, no
 *   migration, no dependency.
 * - **Anything else:** implement `IntegrationAdapter` (+ the optional capability interfaces) and
 *   call `registerIntegrationAdapter(adapter)` once at boot. The provider key is a string in the DB,
 *   so the new adapter becomes selectable immediately — there is no catalog table to migrate and no
 *   enum to extend.
 *
 * This mirrors `DeviceAdapterRegistry` in the attendance module, which solved the same problem for
 * hardware vendors, and `PROVIDERS_BY_CHANNEL` in @college-erp/notifications. Consistency across
 * three subsystems matters here: an engineer who has learned one of them already knows this one.
 *
 * ## Why resolution takes config + credentials rather than a row
 *
 * The registry holds no state and no database access. It is handed what the caller already
 * decrypted, so the same registry instance is valid in both apps/api (connection tests, synchronous
 * dispatch) and apps/worker (queued dispatch) without either knowing about the other.
 */

import { IntegrationConfigError, isKnownCategory, PROVIDERS_BY_CATEGORY } from './categories';
import { HttpJsonAdapter } from './adapters/http-json.adapter';
import { MockAdapter } from './adapters/mock.adapter';
import { WebhookOnlyAdapter } from './adapters/webhook.adapter';
import type {
  AdapterCapabilities,
  ConnectionTester,
  IntegrationAdapter,
  PullSynchronizer,
  PushSynchronizer,
  WebhookHandler,
} from './types';

export interface ResolvedIntegrationAdapter {
  adapter: IntegrationAdapter;
  /** Which optional capabilities this adapter actually implements. */
  capabilities: AdapterCapabilities;
  connectionTest?: ConnectionTester;
  pullSync?: PullSynchronizer;
  pushSync?: PushSynchronizer;
  webhook?: WebhookHandler;
}

export class IntegrationAdapterRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();
  /** Providers the caller supplied, so validation can tell "registered at runtime" from "typo". */
  private readonly runtimeRegistered = new Set<string>();

  constructor() {
    // Built-ins. Stateless, so one shared instance each is fine.
    this.register(new HttpJsonAdapter());
    this.register(new MockAdapter());
    this.register(new WebhookOnlyAdapter());
  }

  /**
   * Registers (or replaces) an adapter.
   *
   * Accepts a ready adapter or a factory. A factory is invoked immediately, at boot, because the
   * provider key IS the adapter's `name` and the key must be validated before any tenant traffic
   * can reach it — a lazily-constructed adapter would first fail during a live dispatch, which is the
   * worst time to discover a typo.
   */
  register(adapter: IntegrationAdapter | (() => IntegrationAdapter)): void {
    const instance = typeof adapter === 'function' ? adapter() : adapter;
    if (!instance.name) {
      throw new IntegrationConfigError('An integration adapter must expose a non-empty `name`.');
    }
    this.adapters.set(instance.name.toLowerCase(), instance);
    // Built-in keys are never "runtime registered": providersFor() already reports them via
    // PROVIDERS_BY_CATEGORY, and treating them as extras would duplicate them in that list.
    if (!['http_json', 'webhook', 'mock'].includes(instance.name.toLowerCase())) {
      this.runtimeRegistered.add(instance.name.toLowerCase());
    }
  }

  has(provider: string): boolean {
    return this.adapters.has(provider.toLowerCase());
  }

  /** Whether `provider` was supplied by the host app rather than shipped here. */
  isRuntimeRegistered(provider: string): boolean {
    return this.runtimeRegistered.has(provider.toLowerCase());
  }

  /**
   * Resolves the adapter for a configured integration, with its capabilities.
   *
   * Throws `IntegrationConfigError` with the list of supported providers when the key is unknown:
   * silently falling back would send a tenant's payment traffic to a mock adapter, which is the
   * worst possible failure mode for this subsystem.
   */
  resolve(category: string, provider: string): ResolvedIntegrationAdapter {
    const adapter = this.adapters.get(provider.toLowerCase());
    if (!adapter) {
      const supported = isKnownCategory(category) ? PROVIDERS_BY_CATEGORY[category] : [];
      throw new IntegrationConfigError(
        `No adapter registered for provider "${provider}". ` +
          (supported.length > 0 ? `Supported for ${category}: ${supported.join(', ')}. ` : '') +
          'Register one with registerIntegrationAdapter() at boot to use a custom provider.',
      );
    }

    // The capability map is derived by duck-typing rather than declared, so an adapter cannot claim
    // a capability it forgot to implement — the caller would get an undefined method at runtime.
    const capabilities: AdapterCapabilities = {};
    if (isConnectionTester(adapter)) capabilities.connectionTest = adapter;
    if (isPullSynchronizer(adapter)) capabilities.pullSync = adapter;
    if (isPushSynchronizer(adapter)) capabilities.pushSync = adapter;
    if (isWebhookHandler(adapter)) capabilities.webhook = adapter;

    return {
      adapter,
      capabilities,
      connectionTest: capabilities.connectionTest,
      pullSync: capabilities.pullSync,
      pushSync: capabilities.pushSync,
      webhook: capabilities.webhook,
    };
  }

  /** Provider keys available for a category: built-ins plus everything registered at runtime. */
  providersFor(category: string): string[] {
    const base = isKnownCategory(category) ? [...PROVIDERS_BY_CATEGORY[category]] : [];
    const extra = [...this.runtimeRegistered].filter((provider) => !base.includes(provider));
    return [...base, ...extra];
  }
}

/** Structural checks — an adapter implements a capability by having its method. */
function isConnectionTester(adapter: IntegrationAdapter): adapter is IntegrationAdapter & ConnectionTester {
  return typeof (adapter as Partial<ConnectionTester>).testConnection === 'function';
}

function isPullSynchronizer(adapter: IntegrationAdapter): adapter is IntegrationAdapter & PullSynchronizer {
  return typeof (adapter as Partial<PullSynchronizer>).pull === 'function';
}

function isWebhookHandler(adapter: IntegrationAdapter): adapter is IntegrationAdapter & WebhookHandler {
  return typeof (adapter as Partial<WebhookHandler>).handleWebhook === 'function';
}

function isPushSynchronizer(adapter: IntegrationAdapter): adapter is IntegrationAdapter & PushSynchronizer {
  return typeof (adapter as Partial<PushSynchronizer>).push === 'function';
}

/** Singleton shared by the API module and (in a separate process) the worker's processors. */
export const integrationAdapterRegistry = new IntegrationAdapterRegistry();

/** Convenience for host apps registering bespoke adapters at boot. */
export function registerIntegrationAdapter(adapter: IntegrationAdapter | (() => IntegrationAdapter)): void {
  integrationAdapterRegistry.register(adapter);
}
