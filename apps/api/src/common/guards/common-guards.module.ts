import { Module } from '@nestjs/common';
import { RbacModule } from '../../modules/rbac/rbac.module';
import { AuditInterceptor } from '../interceptors/audit.interceptor';
import { FeatureFlagsGuard } from './feature-flag.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformRoleGuard } from './platform-role.guard';
import { TenantMatchGuard } from './tenant-match.guard';

/** Every feature module whose controllers use these guards/interceptor must import this
 * module — Nest resolves @UseGuards()/@UseInterceptors() class references against the
 * controller's own module provider graph, not a global registry. */
@Module({
  imports: [RbacModule],
  providers: [
    JwtAuthGuard,
    PlatformAuthGuard,
    TenantMatchGuard,
    PermissionsGuard,
    FeatureFlagsGuard,
    PlatformRoleGuard,
    AuditInterceptor,
  ],
  exports: [
    JwtAuthGuard,
    PlatformAuthGuard,
    TenantMatchGuard,
    PermissionsGuard,
    FeatureFlagsGuard,
    PlatformRoleGuard,
    AuditInterceptor,
  ],
})
export class CommonGuardsModule {}
