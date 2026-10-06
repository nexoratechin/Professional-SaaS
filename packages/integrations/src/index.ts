/**
 * @college-erp/integrations — the vendor-neutral integration framework's pure core.
 *
 * Deliberately framework-free (no Nest, no Prisma client) so it can be unit-tested in isolation and
 * used identically from apps/api (connection tests, synchronous dispatch) and apps/worker (queued
 * dispatch, sync runs). The Nest wiring and database access live in
 * `apps/api/src/modules/integrations`.
 *
 * Layering, innermost first:
 *
 *   types.ts      the adapter contract — the single seam to every external system
 *   categories.ts what kind of system this is, and what config it therefore needs
 *   registry.ts   provider key -> executable adapter (+ capability resolution)
 *   adapters/     the shipped adapters (http_json, webhook, mock)
 *   cipher.ts     reversible encryption for credentials at rest
 *   signature.ts  inbound webhook signature verification
 *   retry.ts      transient vs permanent classification, backoff, policy resolution
 *   redact.ts     keeps secrets out of the log tables
 *   sync.ts       change detection and run-status derivation for synchronization
 *   executor.ts   the shared outbound-call engine both apps/api and apps/worker run
 */

export * from './categories';
export * from './types';
export * from './registry';
export * from './cipher';
export * from './signature';
export * from './retry';
export * from './redact';
export * from './sync';
export * from './executor';
export * from './adapters/http-json.adapter';
export * from './adapters/webhook.adapter';
export * from './adapters/mock.adapter';
