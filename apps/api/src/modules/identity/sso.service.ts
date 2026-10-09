import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'crypto';
import { AUDIT_ACTIONS, AUDIT_MODULES, isClaimEmailVerified, isEmailDomainAllowed, resolveMappedRoleIds } from '@college-erp/auth';
import { IntegrationSecretCipher } from '@college-erp/integrations';
import type { SsoProviderSummaryDto } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { SecurityEventsService } from '../security/security-events.service';
import { AuthService, USER_WITH_ROLES_INCLUDE, type RequestMeta, type UserWithRoles } from '../auth/auth.service';
import { MfaChallengeService } from '../auth/mfa-challenge.service';
import { OidcService, type OidcIdTokenClaims } from './oidc.service';

const STATE_TTL_SECONDS = 300;

interface SsoStatePayload {
  tenantId: string;
  providerId: string;
  providerKey: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
}

export interface SsoStartResult {
  authorizationUrl: string;
}

export interface SsoCallbackOutcome {
  /** Absolute frontend URL the browser should be sent to. */
  redirectUrl: string;
  /** Present only on a fully-authenticated outcome (absent when MFA is still required or on error). */
  rawRefreshToken?: string;
  /** Set when the provider/user requires a second factor before a session is issued. */
  mfaChallengeToken?: string;
}

type ProviderRow = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  status: string;
  issuer: string;
  discoveryUrl: string | null;
  clientId: string;
  clientSecretEncrypted: string | null;
  scopes: string[];
  allowedEmailDomains: string[];
  autoProvisionUsers: boolean;
  defaultRoleId: string | null;
  enforceEmailVerified: boolean;
};

/**
 * Orchestrates the OIDC authorization-code flow: start (build auth URL + stash state in Redis),
 * callback (exchange code, verify id_token, JIT-provision / link the user, map IdP groups to roles,
 * then either issue a session or hand off to the MFA challenge).
 *
 * Everything here runs BEFORE a session/JWT exists, so it uses PlatformPrismaService with an
 * explicit tenantId — taken from the Redis state, never from caller input — matching
 * AuthService/MfaService's pre-auth convention. The state key stored in Redis is the SHA-256 of the
 * opaque state value, so a Redis leak can't forge a callback.
 */
@Injectable()
export class SsoService {
  private readonly cipher: IntegrationSecretCipher;

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly oidc: OidcService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly authService: AuthService,
    private readonly mfaChallenge: MfaChallengeService,
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
    private readonly securityEvents: SecurityEventsService,
    private readonly appConfig: AppConfigService,
  ) {
    this.cipher = new IntegrationSecretCipher(appConfig.get('INTEGRATION_SECRET_KEY'));
  }

  // ── Login page support ──────────────────────────────────────────────────────

  async listActiveProviders(tenantId: string): Promise<SsoProviderSummaryDto[]> {
    const providers = await this.platformPrisma.client.identityProvider.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { key: true, name: true, protocol: true },
      orderBy: { name: 'asc' },
    });
    return providers.map((provider) => ({
      key: provider.key,
      name: provider.name,
      protocol: provider.protocol as SsoProviderSummaryDto['protocol'],
    }));
  }

  // ── Start ───────────────────────────────────────────────────────────────────

  async start(
    tenantId: string,
    providerKey: string,
    returnTo: string | undefined,
    redirectUri: string,
  ): Promise<SsoStartResult> {
    const provider = (await this.platformPrisma.client.identityProvider.findUnique({
      where: { tenantId_key: { tenantId, key: providerKey } },
    })) as unknown as ProviderRow | null;
    if (!provider) {
      throw new NotFoundException('Identity provider not found.');
    }
    if (provider.status !== 'ACTIVE') {
      throw new BadRequestException('This identity provider is not active.');
    }

    const discovery = await this.oidc.discover(provider.issuer, provider.discoveryUrl);
    const state = OidcService.randomToken();
    const nonce = OidcService.randomToken();
    const pkce = OidcService.generatePkce();

    const payload: SsoStatePayload = {
      tenantId,
      providerId: provider.id,
      providerKey: provider.key,
      nonce,
      codeVerifier: pkce.verifier,
      redirectUri,
      returnTo: returnTo ?? '/dashboard',
    };
    await this.redis.set(
      this.stateKey(state),
      JSON.stringify(payload),
      'EX',
      STATE_TTL_SECONDS,
    );

    const authorizationUrl = this.oidc.buildAuthorizationUrl({
      authorizationEndpoint: discovery.authorization_endpoint,
      clientId: provider.clientId,
      redirectUri,
      scopes: provider.scopes,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    });

    return { authorizationUrl };
  }

  // ── Callback ────────────────────────────────────────────────────────────────

  async handleCallback(
    code: string | undefined,
    state: string | undefined,
    meta: RequestMeta,
    redirectUri: string,
  ): Promise<SsoCallbackOutcome> {
    if (!code || !state) {
      return this.errorRedirect('invalid_request');
    }

    const rawPayload = await this.redis.get(this.stateKey(state));
    if (!rawPayload) {
      return this.errorRedirect('invalid_state');
    }
    await this.redis.del(this.stateKey(state));
    const payload = JSON.parse(rawPayload) as SsoStatePayload;

    const provider = (await this.platformPrisma.client.identityProvider.findFirst({
      where: { id: payload.providerId, tenantId: payload.tenantId },
    })) as unknown as ProviderRow | null;
    if (!provider) {
      await this.recordFailure(payload.tenantId, '', 'FAILED_SSO_UNKNOWN_PROVIDER', meta, null);
      return this.errorRedirect('unknown_provider');
    }
    if (provider.status !== 'ACTIVE') {
      await this.recordFailure(payload.tenantId, '', 'FAILED_SSO_PROVIDER_DISABLED', meta, provider.id);
      return this.errorRedirect('provider_disabled');
    }
    if (!provider.clientSecretEncrypted) {
      await this.recordFailure(payload.tenantId, '', 'FAILED_SSO', meta, provider.id);
      return this.errorRedirect('provider_misconfigured');
    }

    let claims: OidcIdTokenClaims;
    try {
      const discovery = await this.oidc.discover(provider.issuer, provider.discoveryUrl);
      const { idToken } = await this.oidc.exchangeCode({
        tokenEndpoint: discovery.token_endpoint,
        clientId: provider.clientId,
        clientSecret: this.cipher.decrypt(provider.clientSecretEncrypted),
        redirectUri: payload.redirectUri || redirectUri,
        code,
        codeVerifier: payload.codeVerifier,
      });
      claims = await this.oidc.verifyIdToken(idToken, {
        issuer: discovery.issuer,
        clientId: provider.clientId,
        jwksUri: discovery.jwks_uri,
        nonce: payload.nonce,
      });
    } catch {
      await this.recordFailure(payload.tenantId, '', 'FAILED_SSO', meta, provider.id);
      return this.errorRedirect('token_exchange_failed');
    }

    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email) {
      await this.recordFailure(payload.tenantId, '', 'FAILED_SSO', meta, provider.id);
      return this.errorRedirect('missing_email');
    }
    if (!isEmailDomainAllowed(email, provider.allowedEmailDomains)) {
      await this.recordFailure(payload.tenantId, email, 'FAILED_SSO_DOMAIN_NOT_ALLOWED', meta, provider.id);
      return this.errorRedirect('domain_not_allowed');
    }
    if (provider.enforceEmailVerified && !isClaimEmailVerified(claims)) {
      await this.recordFailure(payload.tenantId, email, 'FAILED_SSO_EMAIL_UNVERIFIED', meta, provider.id);
      return this.errorRedirect('email_unverified');
    }

    // Resolve or JIT-provision the local user.
    let user = (await this.platformPrisma.client.user.findUnique({
      where: { tenantId_email: { tenantId: payload.tenantId, email } },
      include: USER_WITH_ROLES_INCLUDE,
    })) as UserWithRoles | null;

    if (!user) {
      if (!provider.autoProvisionUsers) {
        await this.recordFailure(payload.tenantId, email, 'FAILED_SSO_USER_NOT_PROVISIONED', meta, provider.id);
        return this.errorRedirect('user_not_provisioned');
      }
      user = (await this.provisionUser(payload.tenantId, email, claims, provider.id, meta)) as UserWithRoles;
    }

    if (user.status !== 'ACTIVE') {
      await this.recordFailure(payload.tenantId, email, 'FAILED_USER_INACTIVE', meta, provider.id);
      return this.errorRedirect('user_inactive');
    }

    try {
      await this.linkExternalIdentity(payload.tenantId, user.id, provider, claims, email, meta);
      await this.applyRoleMappings(payload.tenantId, user.id, provider.id, provider.defaultRoleId, claims);
    } catch {
      await this.recordFailure(payload.tenantId, email, 'FAILED_SSO', meta, provider.id);
      return this.errorRedirect('identity_conflict');
    }

    // Re-read so the issued JWT reflects the roles just granted.
    user = (await this.platformPrisma.client.user.findFirstOrThrow({
      where: { id: user.id, tenantId: payload.tenantId },
      include: USER_WITH_ROLES_INCLUDE,
    })) as UserWithRoles;

    const metaWithSso = meta;

    if (user.mfaEnabled) {
      const challengeToken = await this.mfaChallenge.create('TENANT', user.id, metaWithSso, {
        tenantId: payload.tenantId,
        isNewDevice: false,
        authMethod: 'SSO',
        identityProviderId: provider.id,
      });
      return {
        redirectUrl: this.frontendRedirect({ status: 'mfa', challenge: challengeToken, tenant: await this.tenantSlug(payload.tenantId), returnTo: payload.returnTo }),
        mfaChallengeToken: challengeToken,
      };
    }

    const loginResult = await this.authService.completeLogin(payload.tenantId, user, metaWithSso, {
      authMethod: 'SSO',
      identityProviderId: provider.id,
    });
    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId: payload.tenantId,
      userId: user.id,
      eventType: 'SSO_LOGIN_SUCCEEDED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { identityProviderId: provider.id, providerKey: provider.key },
    });

    return {
      redirectUrl: this.frontendRedirect({ status: 'success', tenant: await this.tenantSlug(payload.tenantId), returnTo: payload.returnTo }),
      rawRefreshToken: loginResult.rawRefreshToken,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async provisionUser(
    tenantId: string,
    email: string,
    claims: OidcIdTokenClaims,
    providerId: string,
    meta: RequestMeta,
  ): Promise<UserWithRoles> {
    const fullName =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
      email.split('@')[0] ||
      email;

    let user: UserWithRoles;
    try {
      user = (await this.platformPrisma.client.user.create({
        data: {
          tenantId,
          email,
          fullName,
          // No local password: this account only ever authenticates through the IdP.
          passwordHash: null,
          status: 'ACTIVE',
          // The IdP asserted the email (enforced above), so treat it as verified.
          emailVerifiedAt: new Date(),
        },
        include: USER_WITH_ROLES_INCLUDE,
      })) as UserWithRoles;
    } catch {
      // Lost a provisioning race for the same (tenant, email) — the other request won; re-read.
      user = (await this.platformPrisma.client.user.findFirstOrThrow({
        where: { tenantId, email },
        include: USER_WITH_ROLES_INCLUDE,
      })) as UserWithRoles;
      return user;
    }

    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId: user.id,
      eventType: 'SSO_USER_PROVISIONED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { identityProviderId: providerId },
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.SSO_USER_PROVISIONED,
      module: AUDIT_MODULES.IDENTITY,
      entityType: 'User',
      entityId: user.id,
      after: { email, identityProviderId: providerId },
    });
    return user;
  }

  private async linkExternalIdentity(
    tenantId: string,
    userId: string,
    provider: ProviderRow,
    claims: OidcIdTokenClaims,
    email: string,
    meta: RequestMeta,
  ): Promise<void> {
    const subject = claims.sub;

    const bySubject = await this.platformPrisma.client.externalIdentity.findFirst({
      where: { identityProviderId: provider.id, subject },
    });
    if (bySubject && bySubject.userId !== userId) {
      // Another local user already owns this external account — refuse rather than silently
      // handing over the account (the pre-MFA check here mirrors the unique constraints).
      throw new UnauthorizedException('This external identity is already linked to another user.');
    }

    const existing = await this.platformPrisma.client.externalIdentity.findFirst({
      where: { userId, identityProviderId: provider.id },
    });

    if (!existing) {
      await this.platformPrisma.client.externalIdentity.create({
        data: {
          tenantId,
          userId,
          identityProviderId: provider.id,
          subject,
          email,
          claims: claims as object,
          lastLoginAt: new Date(),
        },
      });
      await this.securityEvents.record({
        scope: 'TENANT',
        tenantId,
        userId,
        eventType: 'SSO_IDENTITY_LINKED',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { identityProviderId: provider.id, providerKey: provider.key },
      });
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'SYSTEM',
        action: AUDIT_ACTIONS.SSO_IDENTITY_LINKED,
        module: AUDIT_MODULES.IDENTITY,
        entityType: 'ExternalIdentity',
        entityId: userId,
        after: { identityProviderId: provider.id, subject },
      });
      return;
    }

    await this.platformPrisma.client.externalIdentity.update({
      where: { id: existing.id },
      data: { subject, email, claims: claims as object, lastLoginAt: new Date() },
    });
  }

  /**
   * Applies IdP-group -> local-role mappings (union) plus the provider's default role when nothing
   * matched. Only roles that actually exist in this tenant are granted. UserRole rows are upserted,
   * so re-running is idempotent, and the permission cache is invalidated so the change is visible
   * on the very next request.
   */
  private async applyRoleMappings(
    tenantId: string,
    userId: string,
    providerId: string,
    defaultRoleId: string | null,
    claims: OidcIdTokenClaims,
  ): Promise<void> {
    const mappings = await this.platformPrisma.client.identityProviderRoleMapping.findMany({
      where: { identityProviderId: providerId },
      select: { claimName: true, claimValue: true, roleId: true },
    });

    let roleIds = resolveMappedRoleIds(claims, mappings);
    if (roleIds.length === 0 && defaultRoleId) {
      roleIds = [defaultRoleId];
    }
    if (roleIds.length === 0) {
      return;
    }

    const validRoles = await this.platformPrisma.client.role.findMany({
      where: { tenantId, id: { in: roleIds }, deletedAt: null },
      select: { id: true },
    });
    if (validRoles.length === 0) {
      return;
    }

    await this.platformPrisma.client.$transaction(
      validRoles.map((role) =>
        this.platformPrisma.client.userRole.upsert({
          where: { tenantId_userId_roleId: { tenantId, userId, roleId: role.id } },
          update: {},
          create: { tenantId, userId, roleId: role.id },
        }),
      ),
    );

    await this.permissionsService.invalidate(tenantId, userId);
  }

  private async recordFailure(
    tenantId: string,
    email: string,
    result:
      | 'FAILED_SSO'
      | 'FAILED_SSO_UNKNOWN_PROVIDER'
      | 'FAILED_SSO_PROVIDER_DISABLED'
      | 'FAILED_SSO_DOMAIN_NOT_ALLOWED'
      | 'FAILED_SSO_USER_NOT_PROVISIONED'
      | 'FAILED_SSO_EMAIL_UNVERIFIED'
      | 'FAILED_USER_INACTIVE',
    meta: RequestMeta,
    identityProviderId: string | null,
  ): Promise<void> {
    await this.authService.recordLoginEvent(tenantId, email || 'unknown', result, meta, {
      authMethod: 'SSO',
      identityProviderId: identityProviderId ?? undefined,
    });
    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      eventType: 'SSO_LOGIN_FAILED',
      severity: 'WARNING',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { result, identityProviderId },
    });
  }

  private stateKey(state: string): string {
    return `sso-state:${createHash('sha256').update(state).digest('hex')}`;
  }

  private async tenantSlug(tenantId: string): Promise<string> {
    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    return tenant?.slug ?? '';
  }

  private frontendRedirect(params: Record<string, string>): string {
    const url = new URL('/sso/callback', this.webBaseUrl());
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private errorRedirect(code: string): SsoCallbackOutcome {
    return { redirectUrl: this.frontendRedirect({ status: 'error', code }) };
  }

  private webBaseUrl(): string {
    const configured = this.appConfig.get('CORS_ORIGIN').split(',')[0]?.trim();
    return configured || 'http://localhost:5173';
  }
}
