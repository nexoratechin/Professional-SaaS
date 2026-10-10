-- Self-service college onboarding wizard sessions. Control-plane table (nullable tenant_id): a
-- session is created in step 1 ("create account") BEFORE its tenant exists in step 2 ("create
-- college"). Only the SHA-256 hash of the opaque session token is stored (token_hash), matching the
-- refresh-token hardening in the sessions table — a database dump never yields a usable token.
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID,
    "tenant_slug" TEXT,
    "tenant_name" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "completed_steps" JSONB NOT NULL DEFAULT '[]',
    "account_email" TEXT NOT NULL,
    "account_full_name" TEXT NOT NULL,
    "account_password_hash" TEXT NOT NULL,
    "admin_user_id" UUID,
    "admin_email" TEXT,
    "admin_full_name" TEXT,
    "plan_code" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- Token lookup is by hash on every wizard request; uniqueness also enforces one session per token.
CREATE UNIQUE INDEX "onboarding_sessions_token_hash_key" ON "onboarding_sessions"("token_hash");

-- Session-by-tenant (resume/support) and lifecycle/expiry sweeps.
CREATE INDEX "onboarding_sessions_tenant_id_idx" ON "onboarding_sessions"("tenant_id");
CREATE INDEX "onboarding_sessions_status_idx" ON "onboarding_sessions"("status");
CREATE INDEX "onboarding_sessions_expires_at_idx" ON "onboarding_sessions"("expires_at");

-- Foreign key: onboarding_sessions.tenant_id -> tenants.id. SET NULL (not RESTRICT): deleting a
-- tenant must not be blocked by a historical onboarding record, and the session already stores the
-- account/admin identifiers it needs.
ALTER TABLE "onboarding_sessions"
    ADD CONSTRAINT "onboarding_sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
