import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { AppConfigService } from '../../config/app-config.service';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { MfaDisableDto } from './dto/mfa-disable.dto';
import { MfaEnrollConfirmDto } from './dto/mfa-enroll-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { PlatformMfaService } from './platform-mfa.service';
import { setRefreshCookie } from './refresh-cookie.util';

/** Matches PlatformAuthController's login throttle. */
const MFA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('platform-auth')
@Controller('platform/auth/mfa')
export class PlatformMfaController {
  constructor(
    private readonly platformMfaService: PlatformMfaService,
    private readonly config: AppConfigService,
  ) {}

  @Get('status')
  @UseGuards(PlatformAuthGuard)
  status(@CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.platformMfaService.status(platformUser.id);
  }

  @Post('enroll')
  @UseGuards(PlatformAuthGuard)
  enroll(@CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.platformMfaService.enroll(platformUser.id);
  }

  @Post('enroll/confirm')
  @UseGuards(PlatformAuthGuard)
  confirmEnroll(@Body() dto: MfaEnrollConfirmDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.platformMfaService.confirmEnroll(platformUser.id, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PlatformAuthGuard)
  async disable(@Body() dto: MfaDisableDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser): Promise<void> {
    await this.platformMfaService.disable(platformUser.id, dto.password);
  }

  @Post('backup-codes/regenerate')
  @UseGuards(PlatformAuthGuard)
  async regenerateBackupCodes(@CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    const backupCodes = await this.platformMfaService.regenerateBackupCodes(platformUser.id);
    return { backupCodes };
  }

  /** Deliberately PUBLIC (no PlatformAuthGuard) — there is no access token yet at this step. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(MFA_THROTTLE)
  async verify(@Body() dto: MfaVerifyDto, @Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response) {
    const result = await this.platformMfaService.verifyChallenge(dto.challengeToken, dto.code, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setRefreshCookie(res, result.rawRefreshToken, this.config);
    return {
      accessToken: result.accessToken,
      platformUser: {
        id: result.platformUser.id,
        email: result.platformUser.email,
        fullName: result.platformUser.fullName,
        role: result.platformUser.role,
      },
    };
  }
}
