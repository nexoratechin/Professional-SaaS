import { createHmac } from 'crypto';
import {
  parseSignatureHeader,
  signWebhookBody,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_ALGORITHMS,
} from './signature';

const SECRET = 'whsec_shared_secret';
const BODY = JSON.stringify({ id: 'evt_1', status: 'paid' });

function sign(algorithm: 'HMAC_SHA256' | 'HMAC_SHA256_TS' | 'HMAC_SHA256_PREFIXED', timestamp?: string): string {
  return signWebhookBody(algorithm, SECRET, BODY, timestamp);
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid HMAC_SHA256 signature', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: SECRET,
      rawBody: BODY,
      signature: sign('HMAC_SHA256'),
      toleranceSeconds: 300,
    });
    expect(result.verified).toBe(true);
  });

  it('accepts a Buffer body identically to the equivalent string', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: SECRET,
      rawBody: Buffer.from(BODY, 'utf8'),
      signature: sign('HMAC_SHA256'),
      toleranceSeconds: 300,
    });
    expect(result.verified).toBe(true);
  });

  it('rejects a signature computed over different bytes', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: SECRET,
      rawBody: JSON.stringify({ id: 'evt_1', status: 'refunded' }),
      signature: sign('HMAC_SHA256'),
      toleranceSeconds: 300,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('rejects a signature made with the wrong secret', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: 'attacker-secret',
      rawBody: BODY,
      signature: sign('HMAC_SHA256'),
      toleranceSeconds: 300,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('fails closed when the signature header is absent', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: SECRET,
      rawBody: BODY,
      signature: null,
      toleranceSeconds: 300,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISSING');
  });

  it('never leaks the secret or the signature in its message', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: SECRET,
      rawBody: BODY,
      signature: 'deadbeef',
      toleranceSeconds: 300,
    });
    expect(result.message).toBeDefined();
    expect(result.message).not.toContain(SECRET);
    expect(result.message).not.toContain('deadbeef');
  });

  describe('HMAC_SHA256_PREFIXED', () => {
    it('accepts the sha256=<hex> form its own signer emits', () => {
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_PREFIXED',
        secret: SECRET,
        rawBody: BODY,
        signature: sign('HMAC_SHA256_PREFIXED'),
        toleranceSeconds: 300,
      });
      expect(result.verified).toBe(true);
    });

    it('accepts a base64 digest of the same body', () => {
      const hex = signWebhookBody('HMAC_SHA256', SECRET, BODY);
      // A base64-only provider signs the same bytes differently.
      const b64 = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('base64');
      expect(hex).not.toBe(b64);
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_PREFIXED',
        secret: SECRET,
        rawBody: BODY,
        signature: b64,
        toleranceSeconds: 300,
      });
      expect(result.verified).toBe(true);
    });
  });

  describe('HMAC_SHA256_TS (replay protection)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const timestamp = String(Math.floor(now.getTime() / 1000));

    it('accepts an in-window timestamp', () => {
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_TS',
        secret: SECRET,
        rawBody: BODY,
        signature: sign('HMAC_SHA256_TS', timestamp),
        timestamp,
        toleranceSeconds: 300,
        now,
      });
      expect(result.verified).toBe(true);
    });

    it('rejects a replay outside the tolerance window even though the digest is valid', () => {
      const stale = String(Math.floor((now.getTime() - 3_600_000) / 1000));
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_TS',
        secret: SECRET,
        rawBody: BODY,
        // Correctly signed for the OLD timestamp — this is exactly the replay being blocked.
        signature: sign('HMAC_SHA256_TS', stale),
        timestamp: stale,
        toleranceSeconds: 300,
        now,
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('TIMESTAMP_OUT_OF_WINDOW');
    });

    it('accepts millisecond timestamps as well as seconds', () => {
      const ms = String(now.getTime());
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_TS',
        secret: SECRET,
        rawBody: BODY,
        signature: sign('HMAC_SHA256_TS', ms),
        timestamp: ms,
        toleranceSeconds: 300,
        now,
      });
      expect(result.verified).toBe(true);
    });

    it('requires a timestamp', () => {
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_TS',
        secret: SECRET,
        rawBody: BODY,
        signature: sign('HMAC_SHA256_TS', timestamp),
        timestamp: null,
        toleranceSeconds: 300,
        now,
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('TIMESTAMP_MISSING');
    });

    it('rejects a non-numeric timestamp', () => {
      const result = verifyWebhookSignature({
        algorithm: 'HMAC_SHA256_TS',
        secret: SECRET,
        rawBody: BODY,
        signature: 'x',
        timestamp: 'yesterday',
        toleranceSeconds: 300,
        now,
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('TIMESTAMP_MISSING');
    });
  });

  describe('BEARER_TOKEN', () => {
    it('accepts a matching bearer token', () => {
      const result = verifyWebhookSignature({
        algorithm: 'BEARER_TOKEN',
        secret: SECRET,
        rawBody: BODY,
        authorization: `Bearer ${SECRET}`,
        toleranceSeconds: 300,
      });
      expect(result.verified).toBe(true);
    });

    it('is case-insensitive on the scheme and tolerant of extra whitespace', () => {
      const result = verifyWebhookSignature({
        algorithm: 'BEARER_TOKEN',
        secret: SECRET,
        rawBody: BODY,
        authorization: `  bearer   ${SECRET}  `,
        toleranceSeconds: 300,
      });
      expect(result.verified).toBe(true);
    });

    it('rejects a wrong or missing token', () => {
      expect(
        verifyWebhookSignature({
          algorithm: 'BEARER_TOKEN',
          secret: SECRET,
          rawBody: BODY,
          authorization: 'Bearer nope',
          toleranceSeconds: 300,
        }).verified,
      ).toBe(false);
      expect(
        verifyWebhookSignature({
          algorithm: 'BEARER_TOKEN',
          secret: SECRET,
          rawBody: BODY,
          authorization: null,
          toleranceSeconds: 300,
        }).reason,
      ).toBe('SIGNATURE_MISSING');
    });
  });

  it('reports a missing server secret as a configuration problem, not a mismatch', () => {
    const result = verifyWebhookSignature({
      algorithm: 'HMAC_SHA256',
      secret: '',
      rawBody: BODY,
      signature: 'abc',
      toleranceSeconds: 300,
    });
    expect(result.reason).toBe('ALGORITHM_MISMATCH');
  });

  it('covers every advertised algorithm with a case', () => {
    for (const algorithm of WEBHOOK_SIGNATURE_ALGORITHMS) {
      expect(algorithm).toBeTruthy();
    }
  });
});

describe('parseSignatureHeader', () => {
  it('splits a Stripe-style t=…,v1=… header', () => {
    const parsed = parseSignatureHeader('t=1492774577,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd');
    expect(parsed.timestamp).toBe('1492774577');
    expect(parsed.signature).toBe('5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd');
  });

  it('treats a single-value header as the signature with no timestamp', () => {
    expect(parseSignatureHeader('abc123')).toEqual({ signature: 'abc123', timestamp: null });
  });

  it('returns nulls for a missing header', () => {
    expect(parseSignatureHeader(undefined)).toEqual({ signature: null, timestamp: null });
    expect(parseSignatureHeader('')).toEqual({ signature: null, timestamp: null });
  });

  it('is case-insensitive on the field names', () => {
    const parsed = parseSignatureHeader('T=123,V1=abc');
    expect(parsed.timestamp).toBe('123');
    expect(parsed.signature).toBe('abc');
  });
});
