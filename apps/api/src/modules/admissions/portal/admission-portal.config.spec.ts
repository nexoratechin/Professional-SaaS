import { DEFAULT_ALLOWED_MIME_TYPES, DEFAULT_CONSENT_TEXT, publicPortalConfig, resolvePortalConfig } from './admission-portal.config';

describe('resolvePortalConfig', () => {
  it('falls back to safe defaults when nothing is configured', () => {
    const config = resolvePortalConfig(null, null);
    expect(config.enabled).toBe(true);
    expect(config.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.allowedMimeTypes).toEqual([...DEFAULT_ALLOWED_MIME_TYPES]);
    expect(config.otp.maxAttempts).toBe(5);
  });

  it('lets a session override copy, support contact and limits', () => {
    const config = resolvePortalConfig(
      { consentVersion: 'v3', maxUploadMb: 4 },
      { consentVersion: 'v4', supportEmail: 'help@college.edu', maxUploadMb: 2 },
    );
    expect(config.consentVersion).toBe('v4');
    expect(config.supportEmail).toBe('help@college.edu');
    expect(config.maxUploadBytes).toBe(2 * 1024 * 1024);
  });

  it('never lets a session re-enable a portal the tenant switched off', () => {
    const config = resolvePortalConfig({ enabled: false }, { enabled: true });
    expect(config.enabled).toBe(false);
  });

  it('clamps upload size and retention to sane bounds', () => {
    expect(resolvePortalConfig(null, { maxUploadMb: 9999 }).maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(resolvePortalConfig(null, { maxUploadMb: 0 }).maxUploadBytes).toBe(1024 * 1024);
    expect(resolvePortalConfig(null, { draftRetentionDays: 9999 }).draftRetentionDays).toBe(180);
    expect(resolvePortalConfig(null, { draftRetentionDays: 0 }).draftRetentionDays).toBe(1);
  });

  it('drops invalid mime entries and falls back when the list becomes empty', () => {
    expect(resolvePortalConfig(null, { allowedMimeTypes: ['image/png', 'nonsense', 42] }).allowedMimeTypes).toEqual([
      'image/png',
    ]);
    expect(resolvePortalConfig(null, { allowedMimeTypes: ['nonsense'] }).allowedMimeTypes).toEqual([
      ...DEFAULT_ALLOWED_MIME_TYPES,
    ]);
  });

  it('publishes only applicant-safe fields', () => {
    const view = publicPortalConfig(resolvePortalConfig(null, null));
    expect(Object.keys(view).sort()).toEqual(
      ['allowedMimeTypes', 'consentText', 'consentVersion', 'maxUploadBytes', 'supportEmail', 'supportPhone'].sort(),
    );
    expect(view).not.toHaveProperty('otp');
  });
});
