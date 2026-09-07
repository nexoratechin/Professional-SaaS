import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { MfaSecretCipher } from '../../common/security/mfa-secret-cipher';
import { AppConfigService } from '../../config/app-config.service';
import { RbacModule } from '../rbac/rbac.module';
import { SecurityModule } from '../security/security.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginRiskService } from './login-risk.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { PasswordHistoryService } from './password-history.service';
import { PasswordResetService } from './password-reset.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PlatformMfaController } from './platform-mfa.controller';
import { PlatformMfaService } from './platform-mfa.service';
import { SessionsService } from './sessions.service';
import { TrustedDevicesController } from './trusted-devices.controller';
import { TrustedDevicesService } from './trusted-devices.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        privateKey: config.get('JWT_PRIVATE_KEY'),
        publicKey: config.get('JWT_PUBLIC_KEY'),
        signOptions: { algorithm: 'RS256', expiresIn: config.get('ACCESS_TOKEN_TTL') },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }),
    CommonGuardsModule,
    RbacModule,
    SecurityModule,
  ],
  controllers: [AuthController, PlatformAuthController, MfaController, PlatformMfaController, TrustedDevicesController],
  providers: [
    AuthService,
    PlatformAuthService,
    JwtStrategy,
    PlatformJwtStrategy,
    PasswordResetService,
    EmailVerificationService,
    SessionsService,
    MfaSecretCipher,
    MfaChallengeService,
    LoginRiskService,
    PasswordHistoryService,
    TrustedDevicesService,
    MfaService,
    PlatformMfaService,
  ],
  exports: [EmailVerificationService],
})
export class AuthModule {}
