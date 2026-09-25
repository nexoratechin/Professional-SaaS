/**
 * Canonical notification channels and the provider names each channel supports, plus validation
 * of a tenant's provider configuration — the single source the API upserts against and the
 * worker's factory dispatches on, so a tenant can never configure a provider the worker would
 * refuse to instantiate.
 */

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** `console` logs the payload and succeeds — the local-dev provider so the pipeline completes
 *  without real gateways. It is only reachable when the worker explicitly allows dev fallback. */
export const PROVIDERS_BY_CHANNEL: Record<NotificationChannel, readonly string[]> = {
  EMAIL: ['smtp', 'console'],
  SMS: ['http', 'console'],
  WHATSAPP: ['http', 'console'],
  PUSH: ['http', 'console'],
  IN_APP: ['in_app'],
};

export function isKnownChannel(channel: string): channel is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(channel);
}

export function isKnownProvider(channel: NotificationChannel, provider: string): boolean {
  return PROVIDERS_BY_CHANNEL[channel].includes(provider);
}

export interface ProviderConfigInput {
  channel: NotificationChannel;
  provider: string;
  /** Non-secret provider settings. */
  config: Record<string, unknown>;
  /** Decrypted credentials (secrets). Never persisted/returned by the API. */
  credentials: Record<string, unknown>;
}

/** Throws ProviderConfigError with a human-readable reason otherwise. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export function assertValidProviderConfig(input: ProviderConfigInput): void {
  if (!isKnownChannel(input.channel)) {
    throw new ProviderConfigError(`Unknown notification channel "${input.channel}".`);
  }
  if (!isKnownProvider(input.channel, input.provider)) {
    throw new ProviderConfigError(
      `Provider "${input.provider}" is not supported for channel ${input.channel}. ` +
        `Supported: ${PROVIDERS_BY_CHANNEL[input.channel].join(', ')}.`,
    );
  }

  const config = input.config;
  switch (input.channel) {
    case 'EMAIL':
      if (input.provider === 'smtp') {
        if (typeof config.host !== 'string' || config.host.length === 0) {
          throw new ProviderConfigError('SMTP provider requires config.host.');
        }
        const port = config.port === undefined ? 587 : Number(config.port);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new ProviderConfigError('SMTP provider config.port must be a valid TCP port.');
        }
        if (typeof config.from !== 'string' || config.from.length === 0) {
          throw new ProviderConfigError('SMTP provider requires config.from (envelope sender).');
        }
      }
      break;
    case 'SMS':
    case 'WHATSAPP':
    case 'PUSH':
      if (input.provider === 'http') {
        if (typeof config.url !== 'string' || config.url.length === 0) {
          throw new ProviderConfigError(`${input.channel} http provider requires config.url.`);
        }
      }
      break;
    case 'IN_APP':
      break;
  }
}