-- Immutability for the centralized audit trail (MySQL port of the previous Postgres trigger).
--
-- The audit trail must never be editable or deletable, even via raw SQL, a misbehaving admin
-- tool, or a future application bug — AuditService itself already only ever INSERTs (no
-- update/delete method exists on it); this trigger makes that a DB-enforced guarantee rather
-- than an application-layer convention.
--
-- MySQL has no CREATE OR REPLACE FUNCTION + trigger pair: each trigger carries its own body and
-- a table may have one trigger per event. SIGNAL SQLSTATE '45000' raises a user-defined error,
-- the MySQL equivalent of the Postgres RAISE EXCEPTION. The statements are single-statement
-- bodies (no BEGIN...END) so no DELIMITER handling is required.

DROP TRIGGER IF EXISTS `platform_audit_logs_immutable_update`;

CREATE TRIGGER `platform_audit_logs_immutable_update`
BEFORE UPDATE ON `platform_audit_logs`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'platform_audit_logs rows are immutable and cannot be updated';

DROP TRIGGER IF EXISTS `platform_audit_logs_immutable_delete`;

CREATE TRIGGER `platform_audit_logs_immutable_delete`
BEFORE DELETE ON `platform_audit_logs`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'platform_audit_logs rows are immutable and cannot be deleted';
