/**
 * Inbound webhook signature verification.
 *
 * Every external system signs its callbacks differently, and getting this wrong is how payment
 * webhooks get forged. Rather than one bespoke verifier per vendor, one algorithm is configured per
 * endpoint (`IntegrationWebhookEndpoint.signatureAlgorithm`) and this module implements them all
 * behind a single call. That is what keeps the ERP vendor-neutral: supporting a new provider's
 * signing style is a row in the DB, not a code change.
 *
 * ## Rules this module enforces
 *
 * 1. **Verify before you trust.** `verifyWebhookSignature` is called with the RAW body before any
 *    JSON parse. A signature is computed over bytes; re-serializing parsed JSON changes key order
 *    and whitespace, which invalidates the digest. Parsing first is a real vulnerability class,
 *    not a theoretical one.
 * 2. **Constant-time comparison.** Every digest comparison goes through `timingSafeEqual`. A
 *    length check precedes it (it throws on mismatch); the check itself leaks only the length,
 *    which is not a secret.
 * 3. **Timestamps are checked, not just signed.** `HMAC_SHA256_TS` binds a timestamp into the
 *    digest; the timestamp is *also* validated against the endpoint's tolerance window so a captured
 *    (timestamp, signature) pair cannot be replayed forever. This is replay protection, not a
 *    nicety: without it a signed "payment succeeded" body is a permanent forged credential.
 * 4. **Fail closed.** An absent signature is a failure, never a pass. There is no "unsigned is OK"
 *    path — a provider that cannot sign uses `BEARER_TOKEN` explicitly, which is a visible,
 *    auditable choice.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SIGNATURE_ALGORITHMS = [
  'HMAC_SHA256',
  'HMAC_SHA256_TS',
  'HMAC_SHA256_PREFIXED',
  'BEARER_TOKEN',
] as const;

export type WebhookSignatureAlgorithm = (typeof WEBHOOK_SIGNATURE_ALGORITHMS)[number];

/** Mirrors the Prisma `WebhookSignatureAlgorithm` enum over the wire. */
export const WEBHOOK_SIGNATURE_ALGORITHM_OPTIONS = [...WEBHOOK_SIGNATURE_ALGORITHMS] as const;

export function isSignatureAlgorithm(value: string): value is WebhookSignatureAlgorithm {
  return (WEBHOOK_SIGNATURE_ALGORITHMS as readonly string[]).includes(value);
}

export interface WebhookSignatureVerificationInput {
  algorithm: WebhookSignatureAlgorithm;
  /** The shared secret, decrypted by the caller. Never logged. */
  secret: string;
  /** Raw request body, exactly as received. */
  rawBody: string | Buffer;
  /** Value of the configured signature header, if present. */
  signature?: string | null;
  /** Value of the timestamp header (required by HMAC_SHA256_TS). */
  timestamp?: string | null;
  /** Value of the Authorization header, for BEARER_TOKEN. */
  authorization?: string | null;
  /** Max clock skew in seconds for HMAC_SHA256_TS. */
  toleranceSeconds: number;
  /** Injectable clock, so the replay window is testable without sleeping. */
  now?: Date;
}

export type WebhookSignatureFailureReason =
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_MISMATCH'
  | 'TIMESTAMP_MISSING'
  | 'TIMESTAMP_OUT_OF_WINDOW'
  | 'ALGORITHM_MISMATCH';

export interface WebhookSignatureVerificationResult {
  verified: boolean;
  reason?: WebhookSignatureFailureReason;
  /** Safe to include in a failure log — never contains the secret or the signature. */
  message?: string;
}

const VERIFIED: WebhookSignatureVerificationResult = { verified: true };

function fail(reason: WebhookSignatureFailureReason, message: string): WebhookSignatureVerificationResult {
  return { verified: false, reason, message };
}

function hexEqual(a: string, b: string): boolean {
  const expected = Buffer.from(a, 'utf8');
  const actual = Buffer.from(b, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Strips the algorithm prefix/suffix some providers wrap the digest in. Stripe sends `t=…,v1=…`
 * (handled by the caller), many others send `sha256=<hex>`.
 */
function stripDigestPrefix(value: string): string {
  const trimmed = value.trim();
  const eq = trimmed.indexOf('=');
  if (eq > 0 && /^[a-z0-9]+$/i.test(trimmed.slice(0, eq))) {
    return trimmed.slice(eq + 1);
  }
  return trimmed;
}

/**
 * Verifies an inbound webhook. Never throws for an untrusted input — an unverified body is an
 * expected, countable outcome that the caller records as a SIGNATURE failure, not a 500.
 */
export function verifyWebhookSignature(input: WebhookSignatureVerificationInput): WebhookSignatureVerificationResult {
  const now = input.now ?? new Date();
  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody;

  if (input.algorithm === 'BEARER_TOKEN') {
    const header = input.authorization?.trim() ?? '';
    const presented = header.toLowerCase().startsWith('bearer ') ? header.slice('bearer '.length).trim() : '';
    if (!presented) {
      return fail('SIGNATURE_MISSING', 'Webhook request carried no bearer token.');
    }
    return hexEqual(presented, input.secret) ? VERIFIED : fail('SIGNATURE_MISMATCH', 'Webhook bearer token did not match.');
  }

  const signature = input.signature?.trim() ?? '';
  if (!signature) {
    return fail('SIGNATURE_MISSING', 'Webhook request carried no signature header.');
  }
  if (!input.secret) {
    return fail('ALGORITHM_MISMATCH', 'No signing secret is configured for this endpoint.');
  }

  if (input.algorithm === 'HMAC_SHA256_TS') {
    const timestamp = input.timestamp?.trim() ?? '';
    if (!timestamp) {
      return fail('TIMESTAMP_MISSING', 'Timestamped signature algorithm requires a timestamp header.');
    }
    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) {
      return fail('TIMESTAMP_MISSING', 'Signature timestamp was not numeric.');
    }
    // Accept seconds or milliseconds: providers disagree, and the magnitude is unambiguous.
    const timestampMs = timestampNumber > 1e12 ? timestampNumber : timestampNumber * 1000;
    const skewMs = Math.abs(now.getTime() - timestampMs);
    if (skewMs > input.toleranceSeconds * 1000) {
      return fail(
        'TIMESTAMP_OUT_OF_WINDOW',
        `Signature timestamp is ${Math.round(skewMs / 1000)}s outside the ${input.toleranceSeconds}s tolerance.`,
      );
    }
    const expected = createHmac('sha256', input.secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
    // Providers send either the bare hex digest or a prefixed variant.
    return hexEqual(stripDigestPrefix(signature), expected) || hexEqual(signature, expected)
      ? VERIFIED
      : fail('SIGNATURE_MISMATCH', 'Timestamped HMAC signature did not match.');
  }

  const expected = createHmac('sha256', input.secret).update(rawBody, 'utf8').digest('hex');

  if (input.algorithm === 'HMAC_SHA256_PREFIXED') {
    const presented = stripDigestPrefix(signature);
    // Some providers send base64 instead of hex for the same digest.
    const expectedBase64 = createHmac('sha256', input.secret).update(rawBody, 'utf8').digest('base64');
    if (hexEqual(presented, expected) || hexEqual(presented, expectedBase64)) {
      return VERIFIED;
    }
    return fail('SIGNATURE_MALFORMED', 'Prefixed HMAC signature did not match (hex or base64).');
  }

  return hexEqual(signature, expected) || hexEqual(stripDigestPrefix(signature), expected)
    ? VERIFIED
    : fail('SIGNATURE_MISMATCH', 'HMAC-SHA256 signature did not match.');
}

/**
 * Builds the signature value a caller should send when it POSTs to a third-party webhook (used by
 * "verify with our endpoint" tooling and by tests). Returns the hex digest; `HMAC_SHA256_TS`
 * additionally needs the timestamp, which the caller passes in so both sides use one value.
 */
export function signWebhookBody(
  algorithm: WebhookSignatureAlgorithm,
  secret: string,
  rawBody: string | Buffer,
  timestamp?: string,
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const message = algorithm === 'HMAC_SHA256_TS' ? `${timestamp ?? ''}.${body}` : body;
  const hex = createHmac('sha256', secret).update(message, 'utf8').digest('hex');
  return algorithm === 'HMAC_SHA256_PREFIXED' ? `sha256=${hex}` : hex;
}

/**
 * Extracts the signature and timestamp from provider-specific header layouts.
 *
 * Stripe-style deliveries pack both into one comma-separated header
 * (`t=1492774577,v1=5257a8...`), which is why `HMAC_SHA256_TS` needs this rather than a plain
 * timestamp header. Returns whatever it can find; verification decides what is sufficient.
 */
export function parseSignatureHeader(
  headerValue: string | undefined | null,
): { signature: string | null; timestamp: string | null } {
  if (!headerValue) return { signature: null, timestamp: null };
  const trimmed = headerValue.trim();
  if (!trimmed.includes('=') || !trimmed.includes(',')) {
    return { signature: trimmed, timestamp: null };
  }
  let signature: string | null = null;
  let timestamp: string | null = null;
  for (const part of trimmed.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    // Field names are lowercased before comparison: providers are not consistent about case
    // (`T=`/`V1=`, `t=`/`v1=`, `timestamp=` all occur in the wild) and an exact-match parser
    // silently degrades to "signature present, timestamp missing", which reads as a replay
    // failure rather than a parsing bug.
    const name = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (name === 't' || name === 'timestamp') timestamp = value;
    if (name === 'v1' || name === 'v0' || name === 'signature') signature = value;
  }
  return { signature, timestamp };
}
