import type { PaymentGatewayProvider } from './gateway.interface';
import { MockGatewayProvider } from './mock-gateway.provider';

export type PaymentGatewayName = 'mock' | 'razorpay';

export interface PaymentGatewayOptions {
  /** Overrides the mock gateway's webhook-signing secret (defaults to PAYMENTS_MOCK_WEBHOOK_SECRET). */
  mockWebhookSecret?: string;
  /** Razorpay key id / secret, supplied by the caller's configuration when that adapter exists. */
  keyId?: string;
  keySecret?: string;
}

/**
 * Resolves the configured gateway adapter. Only `mock` ships today (it is deterministically
 * testable and carries the same HMAC-signature scheme the real adapter would). A `razorpay`
 * adapter is a single new file + one case here, matching the "one adapter, no business-code
 * changes" contract on PaymentGatewayProvider.
 */
export function resolvePaymentGateway(
  name: string,
  options: PaymentGatewayOptions = {},
): PaymentGatewayProvider {
  switch (name) {
    case 'mock':
      return new MockGatewayProvider(options.mockWebhookSecret);
    case 'razorpay':
      throw new Error('The Razorpay payment gateway adapter is not implemented yet; set PAYMENTS_GATEWAY=mock.');
    default:
      throw new Error(`Unknown payment gateway "${name}".`);
  }
}
