import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { AppConfigService } from '../../config/app-config.service';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { LoginDto } from './dto/login.dto';
import { PlatformAuthService } from './platform-auth.service';
import {
  clearPlatformRefreshCookie,
  PLATFORM_REFRESH_COOKIE_NAME,
  setPlatformRefreshCookie,
} from './refresh-cookie.util';

/** Matches AuthController's login throttle — platform accounts are just as attackable. */
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly platformAuthService: PlatformAuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginDto, @Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response) {
    const result = await this.platformAuthService.login(dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (result.mfaRequired) {
      return { mfaRequired: true, challengeToken: result.challengeToken, expiresInSeconds: result.expiresInSeconds };
    }

    setPlatformRefreshCookie(res, result.rawRefreshToken, this.config);
    return {
      accessToken: result.accessToken,
      mfaSetupRequired: result.mfaSetupRequired,
      platformUser: {
        id: result.platformUser.id,
        email: result.platformUser.email,
        fullName: result.platformUser.fullName,
        role: result.platformUser.role,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[PLATFORM_REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token.');
    }

    const { accessToken, rawRefreshToken: nextRawRefreshToken } = await this.platformAuthService.refresh(
      rawRefreshToken,
    );

    setPlatformRefreshCookie(res, nextRawRefreshToken, this.config);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawRefreshToken = req.cookies?.[PLATFORM_REFRESH_COOKIE_NAME];
    if (rawRefreshToken) {
      await this.platformAuthService.logout(rawRefreshToken, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    clearPlatformRefreshCookie(res, this.config);
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatformUser() platformUser: AuthenticatedPlatformUser): AuthenticatedPlatformUser {
    return platformUser;
  }
}
