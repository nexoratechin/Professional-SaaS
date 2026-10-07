-- Global search: per-user recent-search history backing the command palette. Free-text only;
-- results are always re-derived under the caller's current permission + scope grants.

-- CreateTable
CREATE TABLE "search_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_searched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_histories_tenant_id_user_id_last_searched_at_idx" ON "search_histories"("tenant_id", "user_id", "last_searched_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_histories_tenant_id_user_id_query_key" ON "search_histories"("tenant_id", "user_id", "query");

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
