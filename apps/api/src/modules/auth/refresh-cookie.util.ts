import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';

export const REFRESH_COOKIE_NAME = 'refresh_token';

export function setRefreshCookie(res: Response, rawRefreshToken: string, config: AppConfigService): void {
  res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    maxAge: config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000,
    path: '/auth',
  });
}

export function clearRefreshCookie(res: Response, config: AppConfigService): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.get('NODE_ENV') === 'production',
    sameSite: 'strict',
    domain: config.get('COOKIE_DOMAIN'),
    path: '/auth',
  });
}
