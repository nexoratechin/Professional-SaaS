import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@college-erp/auth';
import type { LoginResponseDto } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaEnrollConfirmDto } from './dto/mfa-enroll-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { accessTokenExpiry, toCurrentUserDto } from './login-response.util';
import { MfaService } from './mfa.service';
import { setRefreshCookie } from './refresh-cookie.util';
import { setTrustedDeviceCookie } from './trusted-device-cookie.util';

/** Matches AuthController's login throttle — the MFA challenge is the last line of defense
 * against a stolen password, so it deserves at least as much brute-force protection. */
const MFA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.status(this.tenantContext.tenantId as string, user.id);
  }

  @Post('enroll')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  enroll(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.enroll(this.tenantContext.tenantId as string, user.id);
  }

  @Post('enroll/confirm')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  confirmEnroll(@Body() dto: MfaEnrollConfirmDto, @CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.confirmEnroll(this.tenantContext.tenantId as string, user.id, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async disable(@Body() dto: MfaDisableDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.mfaService.disable(this.tenantContext.tenantId as string, user.id, dto.password);
  }

  @Post('backup-codes/regenerate')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async regenerateBackupCodes(@CurrentUser() user: AuthenticatedUser) {
    const backupCodes = await this.mfaService.regenerateBackupCodes(this.tenantContext.tenantId as string, user.id);
    return { backupCodes };
  }

  /** The second step of a login that returned `{ mfaRequired: true }` — deliberately PUBLIC (no
   * JwtAuthGuard, there is no access token yet), same as /auth/login. Tenant is resolved from
   * the subdomain/header by TenantResolutionMiddleware exactly as it is for /auth/login. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_THROTTLE)
  async verify(
    @Body() dto: MfaVerifyDto,
    @Req() req: RequestWithTenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }

    const { loginResult, rememberDeviceToken, trustedDeviceDays } = await this.mfaService.verifyChallenge(
      req.resolvedTenant.id,
      dto.challengeToken,
      dto.code,
      dto.rememberDevice ?? false,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );

    setRefreshCookie(res, loginResult.rawRefreshToken, this.config);
    if (rememberDeviceToken && trustedDeviceDays) {
      setTrustedDeviceCookie(res, rememberDeviceToken, trustedDeviceDays * 24 * 60 * 60 * 1000, this.config);
    }

    return {
      accessToken: loginResult.accessToken,
      accessTokenExpiresAt: accessTokenExpiry(),
      user: toCurrentUserDto(loginResult.user),
    };
  }
}
