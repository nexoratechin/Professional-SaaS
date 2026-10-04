import {
  ProviderConfigError,
  ProviderDeliveryError,
  WebPushProvider,
  assertValidProviderConfig,
  createNotificationProvider,
} from './index';

const vapid = {
  publicKey: 'BNcRvP-public-key-placeholder',
  privateKey: 'private-key-placeholder',
  subject: 'mailto:admin@college-erp.local',
};

describe('WebPushProvider', () => {
  it('is selected by the factory for the PUSH/web_push pair', () => {
    const provider = createNotificationProvider({
      channel: 'PUSH',
      provider: 'web_push',
      config: vapid,
      credentials: {},
    });
    expect(provider.name).toBe('web_push');
  });

  it('refuses to construct without a full VAPID triple', () => {
    expect(() => new WebPushProvider({ ...vapid, privateKey: '' })).toThrow(ProviderConfigError);
    expect(() => new WebPushProvider({ publicKey: vapid.publicKey })).toThrow(ProviderConfigError);
  });

  it('rejects a device token that is not a serialized PushSubscription without hitting the network', async () => {
    const provider = new WebPushProvider(vapid);
    await expect(
      provider.send({ channel: 'PUSH', to: 'not-json', body: 'hello' }),
    ).rejects.toBeInstanceOf(ProviderDeliveryError);

    await expect(
      provider.send({
        channel: 'PUSH',
        to: JSON.stringify({ endpoint: 'https://push.example/sub', keys: { auth: 'only-auth' } }),
        body: 'hello',
      }),
    ).rejects.toBeInstanceOf(ProviderDeliveryError);
  });

  it('accepts web_push provider config with missing keys (worker injects VAPID from env)', () => {
    expect(() =>
      assertValidProviderConfig({ channel: 'PUSH', provider: 'web_push', config: {}, credentials: {} }),
    ).not.toThrow();
  });

  it('rejects non-string VAPID config values', () => {
    expect(() =>
      assertValidProviderConfig({
        channel: 'PUSH',
        provider: 'web_push',
        config: { publicKey: 42 },
        credentials: {},
      }),
    ).toThrow(ProviderConfigError);
  });
});
