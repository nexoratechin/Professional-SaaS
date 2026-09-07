import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';

export const TRUSTED_DEVICE_COOKIE_NAME = 'trusted_device';

/** Separate cookie from the refresh token — proves "this device already passed an MFA
 * challenge", not "this device is logged in". Same hardening (httpOnly/Secure/SameSite=Strict)
 * since it's just as capable of skipping a security control if stolen. */
export function setTrustedDeviceCookie(
  res: Response,
  rawDeviceToken: string,
  maxAgeMs: number,
  config: AppConfigService,
): void {
  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, rawDeviceToken, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    maxAge: maxAgeMs,
    path: '/auth',
  });
}

export function clearTrustedDeviceCookie(res: Response, config: AppConfigService): void {
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    path: '/auth',
  });
}
