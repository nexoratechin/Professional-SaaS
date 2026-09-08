import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';

export const REFRESH_COOKIE_NAME = 'refresh_token';
/** Distinct name AND path from the tenant cookie above — both realms' login/refresh endpoints
 * live under different path prefixes (/auth/* vs /platform/auth/*), so scoping each cookie to
 * its own realm's path is both correct (the browser only ever sends it where it can be read) and
 * a deliberate isolation boundary: a platform admin's browser session cannot carry a tenant
 * refresh token into a platform request, or vice versa, even by accident. Previously both
 * realms shared this exact cookie name/path, which meant (a) the platform refresh endpoint could
 * never actually receive its cookie in a real browser — /platform/auth/refresh doesn't match a
 * Path=/auth cookie — and (b) logging into both realms in one browser would overwrite one
 * session's cookie with the other's. */
export const PLATFORM_REFRESH_COOKIE_NAME = 'platform_refresh_token';

function setCookie(res: Response, name: string, path: string, rawToken: string, config: AppConfigService): void {
  res.cookie(name, rawToken, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    maxAge: config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000,
    path,
  });
}

function clearCookie(res: Response, name: string, path: string, config: AppConfigService): void {
  res.clearCookie(name, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    path,
  });
}

export function setRefreshCookie(res: Response, rawRefreshToken: string, config: AppConfigService): void {
  setCookie(res, REFRESH_COOKIE_NAME, '/auth', rawRefreshToken, config);
}

export function clearRefreshCookie(res: Response, config: AppConfigService): void {
  clearCookie(res, REFRESH_COOKIE_NAME, '/auth', config);
}

export function setPlatformRefreshCookie(res: Response, rawRefreshToken: string, config: AppConfigService): void {
  setCookie(res, PLATFORM_REFRESH_COOKIE_NAME, '/platform/auth', rawRefreshToken, config);
}

export function clearPlatformRefreshCookie(res: Response, config: AppConfigService): void {
  clearCookie(res, PLATFORM_REFRESH_COOKIE_NAME, '/platform/auth', config);
}
