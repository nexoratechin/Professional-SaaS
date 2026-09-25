/**
 * Notification channel providers — the adapter seam the worker's delivery pipeline dispatches on.
 *
 * Every provider implements `send(message)` and either resolves (delivered) or throws
 * `ProviderDeliveryError` with an explicit `retryable` flag: transient failures (network,
 * 5xx, SMTP 4xx) are retried by BullMQ; permanent failures (4xx, bad address, missing config)
 * fail the notification immediately and go into the delivery log as terminal.
 *
 * Providers shipped (all stdlib-only — no third-party SDKs):
 *  - SmtpProvider          : real ESMTP delivery via the bundled smtp.ts client.
 *  - HttpJsonProvider      : generic REST gateway adapter for SMS / WhatsApp Cloud API / FCM-type
 *                            push — POST a rendered JSON body to a configured URL. Any gateway that
 *                            accepts a JSON HTTP POST (Twilio, MSG91, WhatsApp Cloud API, Firebase
 *                            HTTP v1, …) maps onto it without new code.
 *  - InAppProvider         : the in-app inbox IS the notifications table; resolving means marking
 *                            the row delivered, so this provider is a no-op success.
 *  - ConsoleProvider       : dev-only — logs the payload and succeeds. Only instantiated when the
 *                            caller explicitly enables dev fallback (worker does, in development).
 */
import { sendSmtpEmail, type SmtpConnectionConfig } from './smtp';
import {
  ProviderConfigError,
  assertValidProviderConfig,
  type NotificationChannel,
  type ProviderConfigInput,
} from './settings';

export interface NotificationMessage {
  channel: NotificationChannel;
  /** The address to reach: email address, phone number, or target user id (in-app). */
  to: string;
  subject?: string;
  body: string;
}

export interface ProviderSendResult {
  providerMessageId?: string | null;
  raw?: unknown;
}

export interface NotificationProvider {
  readonly name: string;
  send(message: NotificationMessage): Promise<ProviderSendResult>;
}

export class ProviderDeliveryError extends Error {
  /** true = transient (retry later), false = permanent (fail now). */
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = 'ProviderDeliveryError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

// ── Console (dev) ────────────────────────────────────────────────────────────

export class ConsoleProvider implements NotificationProvider {
  readonly name = 'console';

  async send(message: NotificationMessage): Promise<ProviderSendResult> {
    // The worker/bootstrapping logs the payload; this provider itself stays silent so tests and
    // local dev see the pipeline complete without a real gateway.
    return { providerMessageId: `console-${message.channel.toLowerCase()}-${Date.now()}` };
  }
}

// ── In-app ───────────────────────────────────────────────────────────────────

export class InAppProvider implements NotificationProvider {
  readonly name = 'in_app';

  async send(message: NotificationMessage): Promise<ProviderSendResult> {
    // The Notification row itself is the inbox; the processor marks it read/delivered afterwards.
    return { providerMessageId: `in-app-${message.to}` };
  }
}

// ── Email via SMTP ───────────────────────────────────────────────────────────

export class SmtpProvider implements NotificationProvider {
  readonly name = 'smtp';
  private readonly config: SmtpConnectionConfig;

  constructor(config: Record<string, unknown>, credentials: Record<string, unknown>) {
    const port = config.port === undefined ? 587 : Number(config.port);
    this.config = {
      host: String(config.host ?? ''),
      port,
      secure: config.secure === true,
      starttls: config.starttls !== false,
      from: String(config.from ?? ''),
      username: typeof credentials.username === 'string' ? credentials.username : undefined,
      password: typeof credentials.password === 'string' ? credentials.password : undefined,
      timeoutMs: config.timeoutMs === undefined ? undefined : Number(config.timeoutMs),
    };
  }

  async send(message: NotificationMessage): Promise<ProviderSendResult> {
    try {
      const messageId = await sendSmtpEmail(this.config, message.to, message.subject ?? '', message.body);
      return { providerMessageId: messageId ?? null };
    } catch (error) {
      if (error instanceof ProviderDeliveryError) throw error;
      if (error instanceof Error) {
        throw new ProviderDeliveryError(
          `SMTP delivery failed: ${error.message}`,
          error.name === 'SmtpError' ? (error as { retryable?: boolean }).retryable !== false : true,
          error,
        );
      }
      throw error;
    }
  }
}

// ── Generic JSON HTTP gateway (SMS / WhatsApp / push) ────────────────────────

export interface HttpJsonConfig {
  url: string;
  method?: string;
  /** Static header entries; values may reference `{{token}}` which is substituted from
   * credentials.token (e.g. `Authorization: Bearer {{token}}`). */
  headers?: Record<string, string>;
  /** JSON body template; strings may reference `{{to}}`, `{{subject}}`, `{{token}}`, and the
   * message body is injected where `{{body}}` appears. */
  body?: unknown;
  /** Request timeout in seconds (default 15). */
  timeoutSec?: number;
}

function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, vars));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolate(val, vars);
    }
    return out;
  }
  return value;
}

export class HttpJsonProvider implements NotificationProvider {
  readonly name: string;
  private readonly config: HttpJsonConfig & { channel: NotificationChannel };
  private readonly credentials: Record<string, unknown>;

  constructor(channel: NotificationChannel, provider: string, config: Record<string, unknown>, credentials: Record<string, unknown>) {
    this.name = provider;
    this.config = {
      channel,
      url: String(config.url ?? ''),
      method: typeof config.method === 'string' ? config.method : 'POST',
      headers: (config.headers as Record<string, string> | undefined) ?? {},
      body: config.body ?? { to: '{{to}}', message: '{{body}}' },
    };
    this.credentials = credentials;
  }

  async send(message: NotificationMessage): Promise<ProviderSendResult> {
    if (!this.config.url) {
      throw new ProviderDeliveryError('HTTP gateway provider has no configured URL.', false);
    }
    const token = typeof this.credentials.token === 'string' ? this.credentials.token : '';
    const vars: Record<string, string> = { to: message.to, body: message.body };
    if (message.subject !== undefined) vars.subject = message.subject;
    if (token) vars.token = token;

    const url = interpolate(this.config.url, vars) as string;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.config.headers ?? {})) {
      headers[key] = interpolate(value, vars) as string;
    }
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    headers['user-agent'] = headers['user-agent'] ?? 'college-erp-notifications';

    const body = interpolate(this.config.body, vars);

    const timeoutMs = Number.isFinite(this.config.timeoutSec) ? (this.config.timeoutSec as number) * 1000 : 15_000;
    let response: Response;
    try {
      response = await fetch(url, {
        method: this.config.method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderDeliveryError(
        `HTTP gateway request failed: ${error instanceof Error ? error.message : 'network error'}`,
        true,
        error,
      );
    }

    const responseStatus = response.status;
    const responseText = await response.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = responseText;
    }

    if (responseStatus >= 200 && responseStatus < 300) {
      const json = parsed as Record<string, unknown> | null;
      const messages = Array.isArray(json?.messages) ? (json.messages as Array<Record<string, unknown>>) : [];
      const messageId =
        (typeof json?.messageId === 'string' && json.messageId) ||
        (typeof json?.id === 'string' && json.id) ||
        (typeof messages[0]?.id === 'string' && messages[0].id) ||
        null;
      return { providerMessageId: messageId ?? null, raw: parsed };
    }

    throw new ProviderDeliveryError(
      `HTTP gateway responded ${responseStatus}: ${responseText.slice(0, 400)}`,
      responseStatus >= 500 ? true : false,
      parsed ?? undefined,
    );
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface CreateProviderOptions {
  /** When true, an unconfigured channel falls back to ConsoleProvider (dev only). */
  allowDevFallback?: boolean;
}

export function createNotificationProvider(
  input: ProviderConfigInput,
  options: CreateProviderOptions = {},
): NotificationProvider {
  assertValidProviderConfig(input);

  switch (input.channel) {
    case 'IN_APP':
      return new InAppProvider();
    case 'EMAIL':
      if (input.provider === 'smtp') return new SmtpProvider(input.config, input.credentials);
      return new ConsoleProvider();
    case 'SMS':
    case 'WHATSAPP':
    case 'PUSH':
      if (input.provider === 'http') return new HttpJsonProvider(input.channel, input.provider, input.config, input.credentials);
      return new ConsoleProvider();
  }
  // assertValidProviderConfig above makes this unreachable; kept for exhaustiveness.
  throw new ProviderConfigError(`Unhandled provider combination: ${input.channel}/${input.provider}`);
}

/** Dev fallback used by the worker when a tenant has no configured (active) provider for a
 * channel and NODE_ENV is development — the pipeline completes locally without real gateways. */
export function devConsoleProviderFor(channel: NotificationChannel): NotificationProvider {
  return new ConsoleProvider();
}