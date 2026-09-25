import {
  ConsoleProvider,
  createNotificationProvider,
  HttpJsonProvider,
  InAppProvider,
  ProviderDeliveryError,
  SmtpProvider,
} from './providers';
import { ProviderConfigError } from './settings';

describe('provider factory', () => {
  it('maps EMAIL/smtp to SmtpProvider', () => {
    const provider = createNotificationProvider({
      channel: 'EMAIL',
      provider: 'smtp',
      config: { host: 'smtp.local', port: 587, from: 'noreply@college.local' },
      credentials: { username: 'u', password: 'p' },
    });
    expect(provider).toBeInstanceOf(SmtpProvider);
    expect(provider.name).toBe('smtp');
  });

  it('maps IN_APP to InAppProvider', () => {
    const provider = createNotificationProvider({ channel: 'IN_APP', provider: 'in_app', config: {}, credentials: {} });
    expect(provider).toBeInstanceOf(InAppProvider);
  });

  it('maps SMS/http to HttpJsonProvider and console to ConsoleProvider', () => {
    const http = createNotificationProvider({
      channel: 'SMS',
      provider: 'http',
      config: { url: 'https://gateway.example/sms' },
      credentials: {},
    });
    expect(http).toBeInstanceOf(HttpJsonProvider);
    const console = createNotificationProvider({
      channel: 'WHATSAPP',
      provider: 'console',
      config: {},
      credentials: {},
    });
    expect(console).toBeInstanceOf(ConsoleProvider);
  });

  it('rejects unknown channels/providers with a clear error', () => {
    expect(() =>
      createNotificationProvider({ channel: 'EMAIL', provider: 'carrier-pigeon', config: {}, credentials: {} }),
    ).toThrow(ProviderConfigError);
    expect(() =>
      createNotificationProvider({ channel: 'FAX' as 'EMAIL', provider: 'smtp', config: {}, credentials: {} }),
    ).toThrow(ProviderConfigError);
  });
});

describe('HttpJsonProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
    globalThis.fetch = jest.fn(handler) as unknown as typeof fetch;
  }

  it('renders the body template with recipient, subject and token, and passes bearer auth', async () => {
    const captured = { url: '', init: {} as RequestInit };
    mockFetch(async (url, init) => {
      captured.url = url;
      captured.init = init;
      return new Response(JSON.stringify({ messageId: 'wa-123' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const provider = new HttpJsonProvider(
      'WHATSAPP',
      'http',
      {
        url: 'https://graph.example/v19.0/{{to}}/messages',
        headers: { Authorization: 'Bearer {{token}}' },
        body: { to: '{{to}}', type: 'text', text: { body: '{{body}}' } },
      },
      { token: 'secret-token' },
    );

    const result = await provider.send({ channel: 'WHATSAPP', to: '919999999999', body: 'Hello there' });
    expect(result.providerMessageId).toBe('wa-123');

    const body = JSON.parse(String(captured.init.body));
    expect(body).toEqual({ to: '919999999999', type: 'text', text: { body: 'Hello there' } });
    expect(captured.url).toBe('https://graph.example/v19.0/919999999999/messages');
    expect((captured.init.headers as Record<string, string> | undefined)?.['Authorization']).toBe('Bearer secret-token');
  });

  it('classifies 4xx as terminal and 5xx as retryable', async () => {
    mockFetch(async () => new Response('Bad Request: invalid recipient', { status: 400 }));
    const provider = new HttpJsonProvider('SMS', 'http', { url: 'https://gateway.example/sms' }, {});
    await expect(provider.send({ channel: 'SMS', to: '+1', body: 'x' })).rejects.toMatchObject({
      name: 'ProviderDeliveryError',
      retryable: false,
    });

    mockFetch(async () => new Response('Service Unavailable', { status: 503 }));
    await expect(provider.send({ channel: 'SMS', to: '+1', body: 'x' })).rejects.toMatchObject({ retryable: true });
  });

  it('classifies network failures as retryable', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const provider = new HttpJsonProvider('PUSH', 'http', { url: 'https://fcm.example/send' }, {});
    await expect(provider.send({ channel: 'PUSH', to: 'device-token', body: 'x' })).rejects.toMatchObject({
      name: 'ProviderDeliveryError',
      retryable: true,
    });
  });

  it('extracts a nested messages[0].id as the provider message id', async () => {
    mockFetch(async () => new Response(JSON.stringify({ messages: [{ id: 'sms-77' }] }), { status: 200 }));
    const provider = new HttpJsonProvider('SMS', 'http', { url: 'https://gateway.example/sms' }, {});
    const result = await provider.send({ channel: 'SMS', to: '+1', body: 'x' });
    expect(result.providerMessageId).toBe('sms-77');
  });

  it('fails permanently when no URL is configured', async () => {
    const provider = new HttpJsonProvider('PUSH', 'http', {}, {});
    await expect(provider.send({ channel: 'PUSH', to: 't', body: 'b' })).rejects.toMatchObject({
      name: 'ProviderDeliveryError',
      retryable: false,
    });
  });
});

describe('ConsoleProvider / InAppProvider', () => {
  it('resolve successfully with a stable message id shape', async () => {
    const consoleProvider = new ConsoleProvider();
    const consoleResult = await consoleProvider.send({ channel: 'EMAIL', to: 'a@b.local', body: 'x' });
    expect(consoleResult.providerMessageId).toMatch(/^console-email-\d+$/);

    const inApp = new InAppProvider();
    const inAppResult = await inApp.send({ channel: 'IN_APP', to: 'user-id', body: 'x' });
    expect(inAppResult.providerMessageId).toBe('in-app-user-id');
  });
});

describe('ProviderDeliveryError', () => {
  it('carries the retryable classification and an optional cause', () => {
    const cause = new Error('underlying');
    const err = new ProviderDeliveryError('boom', false, cause);
    expect(err.retryable).toBe(false);
    expect(err.cause).toBe(cause);
  });
});