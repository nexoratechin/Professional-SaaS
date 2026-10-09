import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { SsoStartResponseDto, TenantAuthMethodInfoDto } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { setRefreshCookie } from '../auth/refresh-cookie.util';
import { SecuritySettingsService } from '../security/security-settings.service';
import { SsoStartQueryDto } from './dto/identity.dto';
import { SsoService } from './sso.service';

/** Same tight per-IP window as /auth/login — the SSO start endpoint mints provider redirects and
 *  the callback consumes authorization codes, both worth rate-limiting. */
const SSO_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Public, pre-authentication SSO surface. `providers` and `:providerKey/start` run under the
 * tenant-resolution middleware (the login page sends the tenant header, exactly like /auth/login).
 * `callback` is the one route excluded from that middleware: the IdP redirects the browser straight
 * here with no tenant hint — the tenant is carried inside the Redis state minted at start.
 */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly config: AppConfigService,
  ) {}

  /** Drives the login page: which SSO buttons to show and whether to render the password form. */
  @Get('providers')
  async providers(@Req() req: RequestWithTenant): Promise<TenantAuthMethodInfoDto> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }
    const [settings, ssoProviders] = await Promise.all([
      this.securitySettings.getEffective(req.resolvedTenant.id),
      this.ssoService.listActiveProviders(req.resolvedTenant.id),
    ]);
    return { localAuthEnabled: settings.localAuthEnabled, ssoProviders };
  }

  @Post(':providerKey/start')
  @HttpCode(HttpStatus.OK)
  @Throttle(SSO_THROTTLE)
  async start(
    @Param('providerKey') providerKey: string,
    @Body() dto: SsoStartQueryDto,
    @Req() req: RequestWithTenant,
  ): Promise<SsoStartResponseDto> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }
    return this.ssoService.start(req.resolvedTenant.id, providerKey, dto.returnTo, this.callbackUrl(req));
  }

  /**
   * The IdP redirect target. Sets the refresh cookie on this response and 302s to the frontend,
   * which then exchanges the cookie for an access token via /auth/refresh — tokens are never
   * placed in the redirect URL.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: RequestWithTenant,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.ssoService.handleCallback(
      code,
      state,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      this.callbackUrl(req),
    );
    if (outcome.rawRefreshToken) {
      setRefreshCookie(res, outcome.rawRefreshToken, this.config);
    }
    res.redirect(HttpStatus.FOUND, outcome.redirectUrl);
  }

  /** Public URL the IdP should redirect back to; derived from the request the browser actually
   *  used (trust-proxy is enabled), so it matches the registered redirect URI per environment. */
  private callbackUrl(req: Request): string {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() || req.protocol;
    return `${protocol}://${req.get('host')}/auth/sso/callback`;
  }
}
