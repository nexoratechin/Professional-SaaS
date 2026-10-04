-- PWA student digital ID.
--
-- Additive only — one nullable column plus its unique index; no existing row or query changes.
--
-- The digital ID card rendered in the student portal (and printed) carries a QR whose payload is
-- the public verification URL for this token. The token is random (not derived from the student
-- id or admission number) so a screenshot/leak reveals nothing about the student, and can be
-- rotated by nulling the column. Resolution goes through the unauthenticated
-- GET /public/student-id/verify/:token endpoint, mirroring the certificate qrToken design.
--
-- Nullable because existing students have no token until they first open their ID card; Postgres
-- allows many NULLs under a unique index, so uniqueness only applies once a token exists.

-- AlterTable
ALTER TABLE "students" ADD COLUMN "id_card_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "students_id_card_token_key" ON "students"("id_card_token");
