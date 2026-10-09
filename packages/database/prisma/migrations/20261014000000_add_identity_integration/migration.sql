-- Enterprise identity integration (SSO / external identity providers).
--
-- Additive only — three new tables plus new columns/enum values on existing tables; no existing
-- row or query changes.
--
--   identity_providers                — a tenant's connection to one external IdP (the config root).
--   external_identities               — local User <-> external account link, keyed by IdP subject.
--   identity_provider_role_mappings   — IdP group/claim value -> local Role mapping.
--
-- Design notes:
--   * The client secret is stored encrypted (AES-256-GCM via @college-erp/integrations'
--     IntegrationSecretCipher), never in plaintext, and is never returned by the API.
--   * OIDC endpoints/keys are discovered from the issuer at runtime and cached in Redis rather than
--     stored here, so a provider rotating endpoints needs no migration.
--   * login_events gains auth_method + identity_provider_id so "how did this person sign in, and via
--     which provider" is answerable without reading log bodies. auth_method defaults to PASSWORD so
--     every existing writer/row is unaffected.
--   * tenant_security_settings gains local_auth_enabled (default true) so an institution can
--     standardize on SSO without that being a breaking change for anyone else.
--
-- On delete behaviour:
--   * Tenant is ON DELETE RESTRICT, matching every other tenant-owned table: a tenant is never
--     deleted out from under its identity configuration.
--   * ExternalIdentity and IdentityProviderRoleMapping cascade off IdentityProvider (they are
--     meaningless without it), and ExternalIdentity cascades off User (removing a user removes their
--     external links).
--   * IdentityProvider.defaultRoleId and LoginEvent.identityProviderId are SET NULL so deleting a
--     role/provider never deletes audit history or a user.
--
-- Every table carries a REQUIRED tenant_id so packages/database's DMMF-derived tenant-guard
-- extension auto-scopes it with no further registration.

-- AlterEnum
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO_UNKNOWN_PROVIDER';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO_PROVIDER_DISABLED';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO_DOMAIN_NOT_ALLOWED';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO_USER_NOT_PROVISIONED';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_SSO_EMAIL_UNVERIFIED';
ALTER TYPE "LoginEventResult" ADD VALUE 'FAILED_LOCAL_AUTH_DISABLED';

-- AlterEnum
ALTER TYPE "SecurityEventType" ADD VALUE 'SSO_LOGIN_SUCCEEDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SSO_LOGIN_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SSO_USER_PROVISIONED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SSO_IDENTITY_LINKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SSO_IDENTITY_UNLINKED';

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'SSO');

-- CreateEnum
CREATE TYPE "IdentityProviderProtocol" AS ENUM ('OIDC');

-- CreateEnum
CREATE TYPE "IdentityProviderStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "IdentityProviderProtocol" NOT NULL DEFAULT 'OIDC',
    "status" "IdentityProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "issuer" TEXT NOT NULL,
    "discovery_url" TEXT,
    "client_id" TEXT NOT NULL,
    "client_secret_encrypted" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'email', 'profile']::TEXT[],
    "allowed_email_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auto_provision_users" BOOLEAN NOT NULL DEFAULT true,
    "default_role_id" UUID,
    "enforce_email_verified" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "identity_provider_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "claims" JSONB,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_provider_role_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "identity_provider_id" UUID NOT NULL,
    "claim_name" TEXT NOT NULL DEFAULT 'groups',
    "claim_value" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_provider_role_mappings_pkey" PRIMARY KEY ("id")
);

-- AlterTable: login history learns how the sign-in happened.
ALTER TABLE "login_events"
    ADD COLUMN "auth_method" "AuthMethod" NOT NULL DEFAULT 'PASSWORD',
    ADD COLUMN "identity_provider_id" UUID;

-- AlterTable: tenant security policy gains an SSO-only switch.
ALTER TABLE "tenant_security_settings"
    ADD COLUMN "local_auth_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_tenant_id_key_key" ON "identity_providers"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "identity_providers_tenant_id_status_idx" ON "identity_providers"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_identity_provider_id_subject_key" ON "external_identities"("identity_provider_id", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_user_id_identity_provider_id_key" ON "external_identities"("user_id", "identity_provider_id");

-- CreateIndex
CREATE INDEX "external_identities_tenant_id_user_id_idx" ON "external_identities"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_role_mappings_identity_provider_id_claim_name_claim_value_key" ON "identity_provider_role_mappings"("identity_provider_id", "claim_name", "claim_value");

-- CreateIndex
CREATE INDEX "identity_provider_role_mappings_tenant_id_identity_provider_id_idx" ON "identity_provider_role_mappings"("tenant_id", "identity_provider_id");

-- CreateIndex
CREATE INDEX "login_events_identity_provider_id_occurred_at_idx" ON "login_events"("identity_provider_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "identity_providers"
    ADD CONSTRAINT "identity_providers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_providers"
    ADD CONSTRAINT "identity_providers_default_role_id_fkey"
    FOREIGN KEY ("default_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities"
    ADD CONSTRAINT "external_identities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities"
    ADD CONSTRAINT "external_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities"
    ADD CONSTRAINT "external_identities_identity_provider_id_fkey"
    FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_role_mappings"
    ADD CONSTRAINT "identity_provider_role_mappings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_role_mappings"
    ADD CONSTRAINT "identity_provider_role_mappings_identity_provider_id_fkey"
    FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_role_mappings"
    ADD CONSTRAINT "identity_provider_role_mappings_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events"
    ADD CONSTRAINT "login_events_identity_provider_id_fkey"
    FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
