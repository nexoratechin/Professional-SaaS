import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Validates a tenant-user access token via JwtStrategy ('jwt'), populating req.user with an
 * AuthenticatedUser. Must run before TenantMatchGuard on any protected tenant route. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
