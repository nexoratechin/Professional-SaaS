import { PlatformMfaController } from './platform-mfa.controller';

jest.mock('./refresh-cookie.util', () => ({
  setRefreshCookie: jest.fn(),
  setPlatformRefreshCookie: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setPlatformRefreshCookie, setRefreshCookie } = jest.requireMock('./refresh-cookie.util') as {
  setPlatformRefreshCookie: jest.Mock;
  setRefreshCookie: jest.Mock;
};

describe('PlatformMfaController realm-cookie isolation', () => {
  it('sets the PLATFORM refresh cookie on platform MFA verify (never the tenant cookie)', async () => {
    const platformMfaService = {
      verifyChallenge: jest.fn().mockResolvedValue({
        rawRefreshToken: 'raw-platform-refresh',
        accessToken: 'access',
        platformUser: { id: 'p1', email: 'a@x.com', fullName: 'A', role: 'PLATFORM_ADMIN' },
      }),
    };
    const controller = new PlatformMfaController(platformMfaService as never, {} as never);
    const res = {} as never;

    await controller.verify({ challengeToken: 'c', code: '123456' } as never, { ip: '1.2.3.4', headers: {} } as never, res);

    expect(setPlatformRefreshCookie).toHaveBeenCalledWith(res, 'raw-platform-refresh', expect.anything());
    expect(setRefreshCookie).not.toHaveBeenCalled();
  });
});
