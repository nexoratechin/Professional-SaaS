import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@college-erp/auth';
import type { CurrentUserDto, LoginResultDto, PermissionsResponseDto } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { RequestWithTenant } from '../../common/types/tenant-request';
import { PermissionsService } from '../rbac/permissions.service';
import { ListSecurityEventsDto } from '../security/dto/list-security-events.dto';
import { SecurityEventsService } from '../security/security-events.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService } from './email-verification.service';
import { accessTokenExpiry, toCurrentUserDto } from './login-response.util';
import { PasswordResetService } from './password-reset.service';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from './refresh-cookie.util';
import { SessionsService } from './sessions.service';
import { TRUSTED_DEVICE_COOKIE_NAME } from './trusted-device-cookie.util';

/** Stricter than the app-wide default (100/min) — login and password-reset endpoints are the
 * ones brute-force/credential-stuffing attempts actually target. This limits attempts per IP;
 * per-account lockout (see AuthService) covers the case where an attacker spreads attempts
 * across many IPs against a single account. */
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly sessionsService: SessionsService,
    private readonly permissionsService: PermissionsService,
    private readonly securityEvents: SecurityEventsService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithTenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResultDto> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }

    const result = await this.authService.login(req.resolvedTenant.id, dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      trustedDeviceToken: req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME],
    });

    if (result.mfaRequired) {
      return { mfaRequired: true, challengeToken: result.challengeToken, expiresInSeconds: result.expiresInSeconds };
    }

    setRefreshCookie(res, result.rawRefreshToken, this.config);
    return {
      accessToken: result.accessToken,
      accessTokenExpiresAt: accessTokenExpiry(),
      user: toCurrentUserDto(result.user),
      mfaSetupRequired: result.mfaSetupRequired,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token.');
    }

    const { accessToken, rawRefreshToken: nextRawRefreshToken } = await this.authService.refresh(rawRefreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setRefreshCookie(res, nextRawRefreshToken, this.config);
    return { accessToken, accessTokenExpiresAt: accessTokenExpiry() };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: RequestWithTenant, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    clearRefreshCookie(res, this.config);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: RequestWithTenant): Promise<void> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }
    await this.passwordResetService.forgotPassword(req.resolvedTenant.id, req.resolvedTenant.slug, dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: RequestWithTenant): Promise<void> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }
    await this.passwordResetService.resetPassword(req.resolvedTenant.id, dto.token, dto.newPassword);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.changePassword(
      this.tenantContext.tenantId as string,
      user.id,
      user.sessionId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: RequestWithTenant): Promise<void> {
    if (!req.resolvedTenant) {
      throw new UnauthorizedException('Tenant context could not be established.');
    }
    await this.emailVerificationService.verifyEmail(req.resolvedTenant.id, dto.token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserDto> {
    const fullUser = await this.tenantPrisma.client.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { userRoles: { include: { role: true } } },
    });
    return toCurrentUserDto(fullUser);
  }

  @Get('permissions')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async permissions(@CurrentUser() user: AuthenticatedUser): Promise<PermissionsResponseDto> {
    const tenantId = this.tenantContext.tenantId as string;
    const permissions = await this.permissionsService.getEffectivePermissions(tenantId, user.id);
    return { permissions };
  }

  /** Richer than /permissions: shows WHAT scope each permission is granted at (GLOBAL vs.
   * CAMPUS/DEPARTMENT/PROGRAM/OWN, with the concrete org-unit id bound at assignment time) —
   * the building block a future module's UI/service would use to know how to filter its own
   * data for the caller. */
  @Get('my-scoped-permissions')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async myScopedPermissions(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = this.tenantContext.tenantId as string;
    return this.permissionsService.getEffectivePermissionsWithScope(tenantId, user.id);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessionsService.listForUser(user.id, user.sessionId);
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async revokeOtherSessions(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.revokeOtherSessions(this.tenantContext.tenantId as string, user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  revokeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sessionsService.revoke(this.tenantContext.tenantId as string, user.id, id, user.id);
  }

  @Get('login-history')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  loginHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.sessionsService.getLoginHistory(this.tenantContext.tenantId as string, user.email);
  }

  @Get('my-security-events')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  mySecurityEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSecurityEventsDto) {
    return this.securityEvents.findForUser(this.tenantContext.tenantId as string, user.id, query);
  }
}
