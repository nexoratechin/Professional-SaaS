import { assertSafeOutboundUrl, isPrivateAddress, SsrfError } from './ssrf';

/**
 * SSRF guard regression tests. The exploit these pin down: a tenant-configured URL (integration
 * baseUrl, attendance device endpoint, OIDC issuer) pointing the server at an internal service.
 */
describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.4',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('flags %s as private/internal', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('assertSafeOutboundUrl', () => {
  it('rejects a non-http(s) scheme', async () => {
    await expect(assertSafeOutboundUrl('ftp://example.com', { allowPrivate: false })).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects the cloud metadata IP even when it is the host', async () => {
    await expect(
      assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/', { allowPrivate: false }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects loopback literals', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1:6379', { allowPrivate: false })).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeOutboundUrl('http://[::1]:9200', { allowPrivate: false })).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects localhost and .internal hostnames', async () => {
    await expect(assertSafeOutboundUrl('http://localhost:3000', { allowPrivate: false })).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeOutboundUrl('http://minio.internal/x', { allowPrivate: false })).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    await expect(
      assertSafeOutboundUrl('https://rebind.attacker.test/x', {
        allowPrivate: false,
        resolve: async () => ['10.0.0.42'],
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('allows a public hostname that resolves to a public address', async () => {
    await expect(
      assertSafeOutboundUrl('https://api.vendor.example/v1', {
        allowPrivate: false,
        resolve: async () => ['93.184.216.34'],
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('does not fail when a hostname cannot be resolved (fetch will fail on its own)', async () => {
    await expect(
      assertSafeOutboundUrl('https://does-not-resolve.example/x', {
        allowPrivate: false,
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('honours an explicit host allowlist for intentionally internal providers', async () => {
    await expect(
      assertSafeOutboundUrl('http://erp.internal:8080/api', { allowPrivate: false, allowedHosts: ['erp.internal'] }),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeOutboundUrl('http://idp.corp.example.com/x', { allowPrivate: false, allowedHosts: ['*.corp.example.com'] }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('skips enforcement when allowPrivate is set (dev/test opt-out)', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1:9000', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
