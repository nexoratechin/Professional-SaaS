/** Enterprise identity / SSO response contracts shared between apps/api and apps/web. */

export type IdentityProviderProtocol = 'OIDC';
export type IdentityProviderStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';

/** Admin view of one external identity provider. Never includes the client secret — only whether
 *  one is configured (`hasClientSecret`) so the settings form can show "•••• set". */
export interface IdentityProviderDto {
  id: string;
  key: string;
  name: string;
  protocol: IdentityProviderProtocol;
  status: IdentityProviderStatus;
  issuer: string;
  discoveryUrl: string | null;
  clientId: string;
  hasClientSecret: boolean;
  scopes: string[];
  allowedEmailDomains: string[];
  autoProvisionUsers: boolean;
  defaultRoleId: string | null;
  /** Role code for `defaultRoleId`, when the role still exists. */
  defaultRoleCode: string | null;
  enforceEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One IdP-group -> local-role mapping row, denormalized with the role's code/name for display. */
export interface IdentityProviderRoleMappingDto {
  id: string;
  identityProviderId: string;
  claimName: string;
  claimValue: string;
  roleId: string;
  roleCode: string | null;
  roleName: string | null;
  createdAt: string;
}

/** Public (pre-auth) summary of an ACTIVE provider, used to render "Sign in with …" buttons on the
 *  login page. Deliberately exposes no client id/issuer/secrets. */
export interface SsoProviderSummaryDto {
  key: string;
  name: string;
  protocol: IdentityProviderProtocol;
}

/** Response of POST /auth/sso/:providerKey/start — full URL the browser is sent to. */
export interface SsoStartResponseDto {
  authorizationUrl: string;
}

/** The tenant's local-auth switch as surfaced to the login page (so password fields can be hidden
 *  when the tenant is SSO-only). */
export interface TenantAuthMethodInfoDto {
  localAuthEnabled: boolean;
  ssoProviders: SsoProviderSummaryDto[];
}
