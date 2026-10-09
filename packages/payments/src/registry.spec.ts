import { MockGatewayProvider } from './mock-gateway.provider';
import { resolvePaymentGateway } from './registry';

describe('resolvePaymentGateway', () => {
  it('resolves the mock gateway with a supplied webhook secret', () => {
    const provider = resolvePaymentGateway('mock', { mockWebhookSecret: 'secret-123' });
    expect(provider).toBeInstanceOf(MockGatewayProvider);
    expect(provider.name).toBe('mock');
  });

  it('fails loudly for an unknown gateway', () => {
    expect(() => resolvePaymentGateway('stripe')).toThrow(/unknown payment gateway/i);
  });

  it('fails loudly for a named-but-unimplemented gateway', () => {
    expect(() => resolvePaymentGateway('razorpay')).toThrow(/not implemented/i);
  });
});

describe('MockGatewayProvider', () => {
  it('fetchOrder reports a successful order', async () => {
    const provider = new MockGatewayProvider('secret-123');
    const event = await provider.fetchOrder('mock_txn_order-1');
    expect(event).toMatchObject({ gatewayTransactionId: 'mock_txn_order-1', status: 'SUCCEEDED' });
  });
});
