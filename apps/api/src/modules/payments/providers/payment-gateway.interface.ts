import type { PaymentMethod, PaymentStatus } from '@college-erp/database';

/**
 * Gateway-neutral contract every payment provider must satisfy. The rest of the Payments module
 * (orders, webhooks, reconciliation, refunds) depends only on this surface, so a new gateway is a
 * single adapter + one registry entry and touches no business code.
 *
 * All amounts are integer minor units (paise/cents). A provider is free to handle zero/fractional
 * display currencies, but every typed amount here is whole units.
 */

/** A raw inbound webhook/notification body before signature verification (never validated). */
export interface GatewayWebhookEnvelope {
  provider: string;
  /** Raw body exactly as received, for signature verification. */
  rawBody: string | Buffer;
  /** Signature headers supplied by the gateway (name differs per provider). */
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
}

/** Normalized, verified webhook contents a provider extracted from its payload. */
export interface VerifiedWebhookEvent {
  /** Stable gateway-side transaction/order id. */
  gatewayTransactionId: string;
  /** Gateway-order link the client was redirected against, if present. */
  orderRef?: string;
  status: PaymentStatus;
  method?: PaymentMethod;
  /** Provider payment id / bank ref / UTR for the money ledger. */
  gatewayReference?: string;
  amountCents?: number;
  currency?: string;
  paidAt?: Date;
  /** Extra normalized facts (fee breakdown notes) for the audit trail / reconciliation. */
  notes?: Record<string, unknown>;
}

/** A payment the API is asking the gateway to create/initiate client-side. */
export interface GatewayOrderRequest {
  amountCents: number;
  currency: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  /** Human-facing label shown on the gateway checkout screen. */
  description?: string;
  /** Reused from the ledger's idempotency key so double-initiation is impossible. */
  orderReference: string;
  returnUrl?: string;
  notes?: Record<string, unknown>;
}

/** The response a provider returns to the client to start checkout. */
export interface GatewayOrder {
  gatewayTransactionId: string;
  orderRef?: string;
  /** Opaque client-side payload (checkout session token/key or payment link). */
  checkoutPayload: Record<string, unknown>;
  checkoutUrl?: string;
  expiresAt?: Date;
  amountCents: number;
  currency: string;
}

export interface PaymentGatewayProvider {
  readonly name: string;

  /** Ask the gateway to prepare an order; idempotent on `orderReference`. */
  createOrder(request: GatewayOrderRequest): Promise<GatewayOrder>;

  /**
   * Verify the webhook signature using the gateway's public key / secret and return the normalized
   * event. MUST throw when the signature is absent or invalid — the module never proceeds on an
   * unverified body. Returns null only for signatures this provider cannot parse as a webhook
   * it should process (e.g. a ping/test event).
   */
  verifyWebhook(envelope: GatewayWebhookEnvelope): Promise<VerifiedWebhookEvent | null>;

  /** Reconcile a previously initiated order's current status (used by the reconciliation queue). */
  fetchOrder(gatewayTransactionId: string): Promise<VerifiedWebhookEvent | null>;

  /** Request a refund of a previously captured transaction (full or partial). */
  refund(input: {
    gatewayTransactionId: string;
    gatewayReference?: string;
    amountCents: number;
    currency: string;
    note?: string;
  }): Promise<string>;
}
