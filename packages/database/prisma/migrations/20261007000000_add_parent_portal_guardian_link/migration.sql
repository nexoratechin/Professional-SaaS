-- Parent/Guardian Portal: link a Guardian (family contact) row to the portal login account.
--
-- Additive only — one nullable column plus an index; no existing row or query changes.
--
-- Design notes:
--   * "user_id" is a bare UUID, deliberately NOT a foreign key — exactly like Student.user_id
--     (see the student_360 migration). The link is application-enforced through the tenant-scoped
--     Prisma client, which auto-scopes every Guardian read/write by tenant_id. This keeps the
--     guardian/account relationship consistent with the established student/account convention.
--   * A guardian may have several children, represented as one Guardian row per student, so the
--     portal resolves the caller's children with a single indexed lookup on (tenant_id, user_id).
--   * The Parent/Guardian Portal authorizes purely off this link (never the PARENT role), so a
--     login that is not attached to any Guardian row can never read a student's data.

-- AlterTable
ALTER TABLE "guardians" ADD COLUMN "user_id" UUID;

-- CreateIndex
CREATE INDEX "guardians_tenant_id_user_id_idx" ON "guardians"("tenant_id", "user_id");
