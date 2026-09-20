import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentMethod, PaymentStatus } from '@college-erp/database';
import {
  type GatewayOrder,
  type GatewayOrderRequest,
  type GatewayWebhookEnvelope,
  type PaymentGatewayProvider,
  type VerifiedWebhookEvent,
} from './payment-gateway.interface';

const MOCK_SECRET = String(process.env.PAYMENTS_MOCK_WEBHOOK_SECRET ?? 'dev-only-mock-secret');
const MOCK_CURRENCY = 'INR';

/**
 * Deterministic development/offline provider. Lets the whole module (orders → checkout → webhook →
 * idempotent ledger write → reconciliation → refund) be exercised end-to-end without a real money
 * movement, and it carries the exact same HMAC-SHA256 signature scheme and status mapping the
 * Razorpay adapter uses — so the verification and reconciliation paths are proven for free.
 */
export class MockGatewayProvider implements PaymentGatewayProvider {
  readonly name = 'mock';

  private signatureFor(body: string): string {
    return createHmac('sha256', MOCK_SECRET).update(body).digest('hex');
  }

  async createOrder(request: GatewayOrderRequest): Promise<GatewayOrder> {
    const gatewayTransactionId = `mock_txn_${request.orderReference}`;
    return {
      gatewayTransactionId,
      orderRef: request.orderReference,
      checkoutPayload: {
        orderId: gatewayTransactionId,
        environment: 'mock',
        amountCents: request.amountCents,
        currency: request.currency ?? MOCK_CURRENCY,
      },
      checkoutUrl: '/payments/mock/checkout',
      expiresAt: new Date(Date.now() + 30 * 60_000),
      amountCents: request.amountCents,
      currency: request.currency ?? MOCK_CURRENCY,
    };
  }

  async verifyWebhook(envelope: GatewayWebhookEnvelope): Promise<VerifiedWebhookEvent | null> {
    const raw = envelope.headers['x-college-erp-signature'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string') return null;

    const body = Buffer.isBuffer(envelope.rawBody) ? envelope.rawBody.toString('utf8') : envelope.rawBody;
    const expected = this.signatureFor(body);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(header, 'utf8');
    if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    const gatewayTransactionId = String(parsed.gatewayTransactionId ?? '');
    if (!gatewayTransactionId) return null;

    return {
      gatewayTransactionId,
      orderRef: parsed.orderRef ? String(parsed.orderRef) : undefined,
      status: this.mapStatus(String(parsed.status ?? 'PENDING')),
      method: parsed.method ? (parsed.method as PaymentMethod) : undefined,
      gatewayReference: parsed.gatewayReference ? String(parsed.gatewayReference) : undefined,
      amountCents: typeof parsed.amountCents === 'number' ? parsed.amountCents : undefined,
      currency: parsed.currency ? String(parsed.currency) : MOCK_CURRENCY,
      paidAt: parsed.paidAt ? new Date(String(parsed.paidAt)) : undefined,
    };
  }

  async fetchOrder(gatewayTransactionId: string): Promise<VerifiedWebhookEvent | null> {
    return {
      gatewayTransactionId,
      orderRef: undefined,
      status: 'SUCCEEDED',
      amountCents: 0,
      currency: MOCK_CURRENCY,
    };
  }

  async refund(input: {
    gatewayTransactionId: string;
    gatewayReference?: string;
    amountCents: number;
    currency: string;
    note?: string;
  }): Promise<string> {
    return `mock_refund_${input.gatewayTransactionId}`;
  }

  private mapStatus(status: string): PaymentStatus {
    switch (status.toUpperCase()) {
      case 'PAID':
      case 'CAPTURED':
      case 'SUCCEEDED':
        return 'SUCCEEDED';
      case 'FAILED':
      case 'FAILURE':
        return 'FAILED';
      case 'REFUNDED':
        return 'REFUNDED';
      case 'PENDING':
      default:
        return 'PENDING';
    }
  }
}
