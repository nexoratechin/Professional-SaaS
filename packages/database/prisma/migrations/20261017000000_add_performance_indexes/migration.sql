-- Performance indexes for high-volume read paths identified in the performance audit.
--
-- All are additive, tenant-leading compound indexes matching real query shapes:
--   * notifications: tenant staff inbox and per-recipient self-service list both filter by
--     (tenant_id | recipient_user_id) and order by created_at DESC.
--   * documents: the documents list filters by tenant_id and orders by created_at DESC.
--
-- These do not change any query semantics and preserve the existing tenant-leading index
-- convention, so tenant isolation filtering stays index-supported.

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_tenant_id_created_at_idx" ON "documents"("tenant_id", "created_at");
