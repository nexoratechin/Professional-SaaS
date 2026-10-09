import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SecurityModule } from '../security/security.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OidcService } from './oidc.service';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

/**
 * Enterprise identity (SSO): admin CRUD for OIDC providers + IdP-group role mappings, and the public
 * pre-auth SSO start/callback flow. Depends one-directionally on AuthModule (for the shared
 * completeLogin / login-event recording / MFA challenge), RbacModule (permission cache invalidate),
 * SecurityModule (security settings + event feed) and AuditModule — none of which depend on this
 * module, so there is no circular graph.
 */
@Module({
  imports: [CommonGuardsModule, RbacModule, SecurityModule, AuditModule, AuthModule],
  controllers: [IdentityController, SsoController],
  providers: [OidcService, IdentityService, SsoService],
  exports: [IdentityService, SsoService],
})
export class IdentityModule {}
