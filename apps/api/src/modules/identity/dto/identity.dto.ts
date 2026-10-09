import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { IdentityProviderProtocol, IdentityProviderStatus } from '@college-erp/database';

export class CreateIdentityProviderDto {
  /** Tenant-unique stable handle used in the public SSO URL (`/auth/sso/:key/...`). Slug because
   *  it becomes a path segment; the display name is free-form. */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, {
    message: 'key must be a lowercase slug of 3-64 characters (letters, digits, hyphens)',
  })
  key: string;

  @IsString()
  @Length(1, 120)
  name: string;

  @IsOptional()
  @IsEnum(IdentityProviderProtocol)
  protocol?: (typeof IdentityProviderProtocol)[keyof typeof IdentityProviderProtocol];

  /** Issuer URL; discovery defaults to `<issuer>/.well-known/openid-configuration`. */
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  issuer: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  discoveryUrl?: string;

  @IsString()
  @Length(1, 255)
  clientId: string;

  /** Write-only. Encrypted at rest and never returned by any endpoint. */
  @IsString()
  @Length(1, 500)
  clientSecret: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsBoolean()
  autoProvisionUsers?: boolean;

  @IsOptional()
  @IsUUID()
  defaultRoleId?: string;

  @IsOptional()
  @IsBoolean()
  enforceEmailVerified?: boolean;
}

export class UpdateIdentityProviderDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  issuer?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  discoveryUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  clientId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsBoolean()
  autoProvisionUsers?: boolean;

  @IsOptional()
  @IsUUID()
  defaultRoleId?: string;

  @IsOptional()
  @IsBoolean()
  enforceEmailVerified?: boolean;
}

export class ChangeIdentityProviderStatusDto {
  @IsEnum(IdentityProviderStatus)
  status: (typeof IdentityProviderStatus)[keyof typeof IdentityProviderStatus];
}

/** Rotate the client secret without touching any other field. Separated from the update DTO so a
 *  settings save can never accidentally blank the secret (and so the credential change is audited
 *  as its own action). */
export class SetIdentityProviderSecretDto {
  @IsString()
  @Length(1, 500)
  clientSecret: string;
}

export class CreateIdentityProviderRoleMappingDto {
  /** Claim to read group memberships from. Defaults to "groups" (some IdPs use "roles"). */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  claimName?: string;

  @IsString()
  @Length(1, 255)
  claimValue: string;

  @IsUUID()
  roleId: string;
}

/** Query for the public provider list on the login page (no tenant context issues — tenant is
 *  resolved by the middleware/header as usual). */
export class SsoStartQueryDto {
  /** Where to send the browser after a successful login. Must be a same-origin path (no scheme or
   *  host) — an open redirect here would let a phishing page harvest a freshly-minted session. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(/^\/(?!\/)[\w\-./?=&%]*$/, {
    message: 'returnTo must be a same-origin path beginning with a single "/"',
  })
  returnTo?: string;
}
