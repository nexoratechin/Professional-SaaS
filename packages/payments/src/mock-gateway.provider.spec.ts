/**
 * MockGatewayProvider — the deterministic provider that carries the same HMAC-SHA256 signature
 * scheme and status mapping a real gateway adapter would. Exercises order creation, webhook
 * verification (valid / invalid / malformed) and refunds. Fully offline.
 */
import { createHmac } from 'node:crypto';
import { MockGatewayProvider } from './mock-gateway.provider';

const SECRET = 'test-webhook-secret';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

function envelope(body: string, signature?: string, asBuffer = false) {
  return {
    provider: 'mock',
    rawBody: asBuffer ? Buffer.from(body, 'utf8') : body,
    headers: signature === undefined ? {} : { 'x-college-erp-signature': signature },
    query: {},
  };
}

describe('MockGatewayProvider.createOrder', () => {
  it('derives a stable gateway transaction id and echoes the amount', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const order = await provider.createOrder({ amountCents: 25000, currency: 'INR', orderReference: 'ref-1' });
    expect(order).toMatchObject({
      gatewayTransactionId: 'mock_txn_ref-1',
      orderRef: 'ref-1',
      amountCents: 25000,
      currency: 'INR',
    });
    expect(order.checkoutPayload).toMatchObject({ orderId: 'mock_txn_ref-1', amountCents: 25000 });
  });
});

describe('MockGatewayProvider.verifyWebhook', () => {
  it('accepts a correctly signed body and normalizes the event', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({
      gatewayTransactionId: 'mock_txn_ref-1',
      orderRef: 'ref-1',
      status: 'PAID',
      method: 'UPI',
      gatewayReference: 'UTR-9',
      amountCents: 25000,
    });
    const event = await provider.verifyWebhook(envelope(body, sign(body)));
    expect(event).toMatchObject({
      gatewayTransactionId: 'mock_txn_ref-1',
      orderRef: 'ref-1',
      status: 'SUCCEEDED',
      method: 'UPI',
      gatewayReference: 'UTR-9',
      amountCents: 25000,
      currency: 'INR',
    });
  });

  it('accepts a Buffer raw body', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({ gatewayTransactionId: 't1', status: 'CAPTURED' });
    const event = await provider.verifyWebhook(envelope(body, sign(body), true));
    expect(event?.status).toBe('SUCCEEDED');
  });

  it('rejects a tampered signature', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({ gatewayTransactionId: 't1', status: 'PAID' });
    await expect(provider.verifyWebhook(envelope(body, sign(body) + 'ff'))).resolves.toBeNull();
  });

  it('rejects a body signed with a different secret', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({ gatewayTransactionId: 't1', status: 'PAID' });
    const wrong = createHmac('sha256', 'other-secret').update(body).digest('hex');
    await expect(provider.verifyWebhook(envelope(body, wrong))).resolves.toBeNull();
  });

  it('rejects a missing signature header', async () => {
    const provider = new MockGatewayProvider(SECRET);
    await expect(provider.verifyWebhook(envelope('{}'))).resolves.toBeNull();
  });

  it('rejects a signed but malformed JSON body', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = 'not-json';
    await expect(provider.verifyWebhook(envelope(body, sign(body)))).resolves.toBeNull();
  });

  it('rejects a signed body with no gateway transaction id', async () => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({ status: 'PAID' });
    await expect(provider.verifyWebhook(envelope(body, sign(body)))).resolves.toBeNull();
  });

  it.each([
    ['PAID', 'SUCCEEDED'],
    ['CAPTURED', 'SUCCEEDED'],
    ['SUCCEEDED', 'SUCCEEDED'],
    ['FAILED', 'FAILED'],
    ['FAILURE', 'FAILED'],
    ['REFUNDED', 'REFUNDED'],
    ['PENDING', 'PENDING'],
    ['SOMETHING_ELSE', 'PENDING'],
  ])('maps gateway status %s to %s', async (gatewayStatus, expected) => {
    const provider = new MockGatewayProvider(SECRET);
    const body = JSON.stringify({ gatewayTransactionId: 't1', status: gatewayStatus });
    const event = await provider.verifyWebhook(envelope(body, sign(body)));
    expect(event?.status).toBe(expected);
  });
});

describe('MockGatewayProvider.refund', () => {
  it('returns a deterministic refund reference', async () => {
    const provider = new MockGatewayProvider(SECRET);
    await expect(
      provider.refund({ gatewayTransactionId: 'mock_txn_ref-1', amountCents: 25000, currency: 'INR' }),
    ).resolves.toBe('mock_refund_mock_txn_ref-1');
  });
});
