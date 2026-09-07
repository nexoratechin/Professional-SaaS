import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { PlatformJwtAccessTokenClaims, AuthenticatedPlatformUser } from '@college-erp/auth';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'jwt-platform') {
  constructor(
    config: AppConfigService,
    private readonly platformPrisma: PlatformPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: PlatformJwtAccessTokenClaims): Promise<AuthenticatedPlatformUser> {
    const session = await this.platformPrisma.client.platformSession.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const platformUser = await this.platformPrisma.client.platformUser.findUnique({ where: { id: payload.sub } });
    if (!platformUser || !platformUser.isActive) {
      throw new UnauthorizedException('Platform user is no longer active.');
    }

    return {
      id: platformUser.id,
      sessionId: session.id,
      email: platformUser.email,
      fullName: platformUser.fullName,
      role: platformUser.role,
    };
  }
}
