import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Validates a platform-admin access token via PlatformJwtStrategy ('jwt-platform') — a
 * deliberately separate universe from tenant RBAC/JwtAuthGuard. */
@Injectable()
export class PlatformAuthGuard extends AuthGuard('jwt-platform') {}
