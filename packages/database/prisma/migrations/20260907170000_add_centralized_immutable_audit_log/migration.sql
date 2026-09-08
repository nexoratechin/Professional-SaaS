-- AlterTable
ALTER TABLE "platform_audit_logs" ADD COLUMN     "actor_email" TEXT,
ADD COLUMN     "module" TEXT NOT NULL DEFAULT 'platform',
ADD COLUMN     "request_id" TEXT;

-- CreateIndex
CREATE INDEX "platform_audit_logs_module_created_at_idx" ON "platform_audit_logs"("module", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_request_id_idx" ON "platform_audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "platform_audit_logs_actor_email_idx" ON "platform_audit_logs"("actor_email");

-- Immutability: the centralized audit trail must never be editable or deletable, even via raw
-- SQL, a misbehaving admin tool, or a future application bug — AuditService itself already only
-- ever INSERTs (no update/delete method exists on it); this trigger makes that a DB-enforced
-- guarantee rather than an application-layer convention.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs rows are immutable and cannot be % (id=%)', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_audit_logs_immutable ON "platform_audit_logs";

CREATE TRIGGER platform_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
