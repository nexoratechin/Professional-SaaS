/**
 * Registry behaviour — the vendor-neutrality contract.
 *
 * These tests exist to pin the properties that make "add a vendor by configuring a row" true, and to
 * pin the *refusals* that keep it from becoming a silent misrouting bug:
 *
 *   - an unknown provider throws instead of falling back (a payment connection silently resolving to
 *     the mock adapter would be the worst failure this subsystem can have);
 *   - a capability is exposed only when the adapter really implements it;
 *   - a runtime-registered adapter becomes selectable with no catalog change.
 */

import { IntegrationAdapterRegistry } from './registry';
import { IntegrationConfigError } from './categories';
import type { ConnectionTester, IntegrationAdapter, WebhookHandler } from './types';

/** A minimal adapter: `execute` only, so every optional capability must resolve to undefined. */
function bareAdapter(name: string): IntegrationAdapter {
  return {
    name,
    async execute() {
      return { providerReference: null, response: null };
    },
  };
}

describe('IntegrationAdapterRegistry', () => {
  let registry: IntegrationAdapterRegistry;

  beforeEach(() => {
    // A fresh instance per test: `register()` mutates state, and a shared instance would let one
    // test's adapter leak into the next one's providersFor() assertions.
    registry = new IntegrationAdapterRegistry();
  });

  describe('built-ins', () => {
    it('registers http_json, mock and webhook', () => {
      expect(registry.has('http_json')).toBe(true);
      expect(registry.has('mock')).toBe(true);
      expect(registry.has('webhook')).toBe(true);
    });

    it('matches provider keys case-insensitively so a stored key casing typo is not fatal', () => {
      expect(registry.has('HTTP_JSON')).toBe(true);
      expect(registry.resolve('ACCOUNTING', 'Http_Json').adapter.name).toBe('http_json');
    });

    it('exposes http_json as a full-capability adapter', () => {
      const resolved = registry.resolve('ACCOUNTING', 'http_json');
      expect(resolved.connectionTest).toBeDefined();
      expect(resolved.pullSync).toBeDefined();
      expect(resolved.pushSync).toBeDefined();
    });

    it('exposes webhook as receive-only: it can report readiness but never sync', () => {
      const resolved = registry.resolve('PAYMENT_GATEWAY', 'webhook');
      // It DOES implement a tester — an inbound-side readiness check, not an outbound probe. That is
      // exactly why capability presence cannot be used to mean "makes outbound calls".
      expect(resolved.connectionTest).toBeDefined();
      expect(resolved.pullSync).toBeUndefined();
      expect(resolved.pushSync).toBeUndefined();
      expect(resolved.webhook).toBeUndefined();
      expect(Object.keys(resolved.capabilities).sort()).toEqual(['connectionTest']);
    });
  });

  describe('resolve', () => {
    it('throws with the supported-provider list for an unknown key instead of falling back', () => {
      expect(() => registry.resolve('PAYMENT_GATEWAY', 'stripe')).toThrow(IntegrationConfigError);
      expect(() => registry.resolve('PAYMENT_GATEWAY', 'stripe')).toThrow(/http_json/);
    });

    it('omits the supported list for a category with no built-in providers', () => {
      expect(() => registry.resolve('NOT_A_CATEGORY', 'nope')).toThrow(IntegrationConfigError);
      expect(() => registry.resolve('NOT_A_CATEGORY', 'nope')).not.toThrow(/Supported for/);
    });

    it('derives capabilities by duck-typing, so a claimed-but-absent method is never exposed', () => {
      registry.register(bareAdapter('half-baked'));
      const resolved = registry.resolve('SMS', 'half-baked');
      // The adapter advertises nothing beyond execute; the registry must not invent a tester.
      expect(resolved.connectionTest).toBeUndefined();
      expect(resolved.capabilities).toEqual({});
      expect(resolved.adapter.execute).toBeInstanceOf(Function);
    });

    it('detects each optional capability from the method alone', () => {
      // Typed as the intersection it actually is: `register` accepts any IntegrationAdapter, and the
      // registry's job is exactly to work out the rest from the runtime shape.
      const kitchenSink: IntegrationAdapter & ConnectionTester & WebhookHandler = {
        name: 'kitchen-sink',
        async execute() {
          return { providerReference: null, response: null };
        },
        async testConnection() {
          return { ok: true, message: 'ok', latencyMs: 1 };
        },
        async handleWebhook() {
          /* no-op */
        },
      };
      registry.register(kitchenSink);
      const resolved = registry.resolve('SMS', 'kitchen-sink');
      expect(resolved.connectionTest).toBeDefined();
      // handleWebhook is a first-class capability now, not a duck-typed cast at the call site.
      expect(resolved.webhook).toBeDefined();
      expect(resolved.pullSync).toBeUndefined();
      expect(resolved.pushSync).toBeUndefined();
    });
  });

  describe('register', () => {
    it('constructs a factory-supplied adapter eagerly, so a bad name fails at boot not mid-dispatch', () => {
      const factory = jest.fn(() => bareAdapter('lazy'));
      registry.register(factory);
      // Eager on purpose: the provider key is the adapter's `name`, so it must be read at
      // registration time. A lazy registry would instead fail at dispatch time — when a tenant's
      // payment is already in flight.
      expect(factory).toHaveBeenCalledTimes(1);
      expect(registry.has('lazy')).toBe(true);
      expect(registry.isRuntimeRegistered('lazy')).toBe(true);
    });

    it('rejects an adapter with no name, because the name IS the database key', () => {
      expect(() => registry.register({ name: '', async execute() { return { providerReference: null, response: null }; } })).toThrow(
        IntegrationConfigError,
      );
    });

    it('replaces a previously registered adapter of the same key', () => {
      const first = bareAdapter('dup');
      const second = { ...bareAdapter('dup'), async testConnection() { return { ok: true, message: 'v2', latencyMs: 1 }; } };
      registry.register(first);
      registry.register(second);
      expect(registry.resolve('SMS', 'dup').connectionTest).toBeDefined();
    });
  });

  describe('providersFor', () => {
    it('never duplicates a built-in that was also registered at runtime', () => {
      // Registering a replacement built-in is legitimate; it must not appear twice in the form list.
      registry.register(bareAdapter('http_json'));
      const providers = registry.providersFor('PAYMENT_GATEWAY');
      expect(providers.filter((p) => p === 'http_json')).toHaveLength(1);
    });

    it('appends runtime adapters to the category list', () => {
      registry.register(bareAdapter('acme-pay'));
      const providers = registry.providersFor('PAYMENT_GATEWAY');
      expect(providers).toContain('http_json');
      expect(providers).toContain('acme-pay');
    });

    it('returns an empty list for an unknown category rather than throwing', () => {
      expect(registry.providersFor('NOT_A_CATEGORY')).toEqual([]);
    });
  });

  describe('isRuntimeRegistered', () => {
    it('distinguishes a host-supplied adapter from a built-in', () => {
      expect(registry.isRuntimeRegistered('http_json')).toBe(false);
      registry.register(bareAdapter('acme-pay'));
      expect(registry.isRuntimeRegistered('acme-pay')).toBe(true);
    });
  });
});