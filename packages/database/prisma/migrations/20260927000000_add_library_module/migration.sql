-- Library module: catalog (categories, publishers, authors, books), physical copies with
-- barcode/QR identity, members, circulation (issue/return/renewal) on the existing
-- student_library_loans table, reservations, fines, per-copy inventory transactions, per-tenant
-- config and sequence allocators.
-- Generated schema matches packages/database/prisma/schema.prisma

-- CreateEnum
CREATE TYPE "LibraryMemberType" AS ENUM ('STUDENT', 'FACULTY', 'STAFF', 'OTHER');

-- CreateEnum
CREATE TYPE "LibraryMemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LibraryCopyStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LibraryCopyCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "LibraryReservationStatus" AS ENUM ('WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LibraryFineType" AS ENUM ('OVERDUE', 'LOST', 'DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "LibraryFineStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "LibraryTransactionType" AS ENUM ('ADDED', 'ISSUED', 'RETURNED', 'RENEWED', 'LOST', 'DAMAGED', 'RESERVED', 'READY', 'FULFILLED', 'CANCELLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LibrarySequenceKind" AS ENUM ('MEMBER', 'COPY');

-- AlterTable
ALTER TABLE "student_library_loans" ALTER COLUMN "student_id" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "student_library_loans" DROP CONSTRAINT "student_library_loans_student_id_fkey";

-- AddForeignKey
ALTER TABLE "student_library_loans" ADD CONSTRAINT "student_library_loans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "student_library_loans" ADD COLUMN "copy_id" UUID,
ADD COLUMN "member_id" UUID,
ADD COLUMN "renewal_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_renewed_at" TIMESTAMP(3),
ADD COLUMN "return_condition" TEXT,
ADD COLUMN "returned_by_id" UUID;

-- CreateTable
CREATE TABLE "library_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_publishers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "full_name" TEXT NOT NULL,
    "bio" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "isbn" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "language" TEXT NOT NULL DEFAULT 'English',
    "edition" TEXT,
    "page_count" INTEGER,
    "publication_year" INTEGER,
    "description" TEXT,
    "cover_storage_key" TEXT,
    "category_id" UUID NOT NULL,
    "publisher_id" UUID,
    "replacement_cost_cents" INTEGER,
    "max_loan_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_book_authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_book_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_copies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "accession_number" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "shelf_location" TEXT,
    "acquisition_type" TEXT,
    "acquisition_date" TIMESTAMP(3),
    "purchase_price_cents" INTEGER,
    "condition" "LibraryCopyCondition" NOT NULL DEFAULT 'GOOD',
    "status" "LibraryCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "member_number" TEXT NOT NULL,
    "student_id" UUID,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "member_type" "LibraryMemberType" NOT NULL DEFAULT 'STUDENT',
    "status" "LibraryMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_loans" INTEGER,
    "membership_start" TIMESTAMP(3),
    "membership_end" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "library_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "copy_id" UUID,
    "member_id" UUID NOT NULL,
    "status" "LibraryReservationStatus" NOT NULL DEFAULT 'WAITING',
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_until" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_fines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "loan_id" UUID,
    "member_id" UUID NOT NULL,
    "type" "LibraryFineType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "LibraryFineStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_by_user_id" UUID,
    "waived_at" TIMESTAMP(3),
    "waived_by_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "copy_id" UUID NOT NULL,
    "loan_id" UUID,
    "member_id" UUID,
    "type" "LibraryTransactionType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "default_loan_days" INTEGER NOT NULL DEFAULT 14,
    "max_loans_per_member" INTEGER NOT NULL DEFAULT 5,
    "renewal_limit" INTEGER NOT NULL DEFAULT 2,
    "overdue_fine_per_day_cents" INTEGER NOT NULL DEFAULT 100,
    "reservation_hold_days" INTEGER NOT NULL DEFAULT 2,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kind" "LibrarySequenceKind" NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_library_loans_copy_id_idx" ON "student_library_loans"("copy_id");

-- CreateIndex
CREATE INDEX "student_library_loans_member_id_idx" ON "student_library_loans"("member_id");

-- CreateIndex
CREATE INDEX "student_library_loans_tenant_id_due_date_status_idx" ON "student_library_loans"("tenant_id", "due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "library_categories_tenant_id_code_key" ON "library_categories"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "library_categories_tenant_id_idx" ON "library_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "library_categories_tenant_id_deleted_at_idx" ON "library_categories"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "library_publishers_tenant_id_code_key" ON "library_publishers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "library_publishers_tenant_id_idx" ON "library_publishers"("tenant_id");

-- CreateIndex
CREATE INDEX "library_publishers_tenant_id_deleted_at_idx" ON "library_publishers"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "library_authors_tenant_id_code_key" ON "library_authors"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "library_authors_tenant_id_idx" ON "library_authors"("tenant_id");

-- CreateIndex
CREATE INDEX "library_authors_tenant_id_full_name_idx" ON "library_authors"("tenant_id", "full_name");

-- CreateIndex
CREATE INDEX "library_authors_tenant_id_deleted_at_idx" ON "library_authors"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_idx" ON "library_books"("tenant_id");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_title_idx" ON "library_books"("tenant_id", "title");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_isbn_idx" ON "library_books"("tenant_id", "isbn");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_category_id_idx" ON "library_books"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "library_books_tenant_id_deleted_at_idx" ON "library_books"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "library_book_authors_tenant_id_book_id_author_id_key" ON "library_book_authors"("tenant_id", "book_id", "author_id");

-- CreateIndex
CREATE INDEX "library_book_authors_tenant_id_author_id_idx" ON "library_book_authors"("tenant_id", "author_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_copies_tenant_id_barcode_key" ON "library_copies"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "library_copies_tenant_id_accession_number_key" ON "library_copies"("tenant_id", "accession_number");

-- CreateIndex
CREATE INDEX "library_copies_tenant_id_idx" ON "library_copies"("tenant_id");

-- CreateIndex
CREATE INDEX "library_copies_tenant_id_book_id_status_idx" ON "library_copies"("tenant_id", "book_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "library_members_tenant_id_member_number_key" ON "library_members"("tenant_id", "member_number");

-- CreateIndex
CREATE UNIQUE INDEX "library_members_tenant_id_student_id_key" ON "library_members"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "library_members_tenant_id_idx" ON "library_members"("tenant_id");

-- CreateIndex
CREATE INDEX "library_members_tenant_id_status_idx" ON "library_members"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "library_members_tenant_id_member_type_idx" ON "library_members"("tenant_id", "member_type");

-- CreateIndex
CREATE INDEX "library_members_tenant_id_deleted_at_idx" ON "library_members"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "library_reservations_tenant_id_idx" ON "library_reservations"("tenant_id");

-- CreateIndex
CREATE INDEX "library_reservations_tenant_id_status_idx" ON "library_reservations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "library_reservations_tenant_id_member_id_status_idx" ON "library_reservations"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "library_reservations_tenant_id_book_id_status_idx" ON "library_reservations"("tenant_id", "book_id", "status");

-- CreateIndex
CREATE INDEX "library_fines_tenant_id_idx" ON "library_fines"("tenant_id");

-- CreateIndex
CREATE INDEX "library_fines_tenant_id_member_id_status_idx" ON "library_fines"("tenant_id", "member_id", "status");

-- CreateIndex
CREATE INDEX "library_fines_tenant_id_status_idx" ON "library_fines"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "library_fines_loan_id_idx" ON "library_fines"("loan_id");

-- CreateIndex
CREATE INDEX "library_transactions_tenant_id_idx" ON "library_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "library_transactions_tenant_id_copy_id_occurred_at_idx" ON "library_transactions"("tenant_id", "copy_id", "occurred_at");

-- CreateIndex
CREATE INDEX "library_transactions_tenant_id_occurred_at_idx" ON "library_transactions"("tenant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "library_configs_tenant_id_key" ON "library_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "library_sequences_tenant_id_kind_prefix_key" ON "library_sequences"("tenant_id", "kind", "prefix");

-- AddForeignKey
ALTER TABLE "student_library_loans" ADD CONSTRAINT "student_library_loans_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "library_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_library_loans" ADD CONSTRAINT "student_library_loans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "library_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_publishers" ADD CONSTRAINT "library_publishers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_authors" ADD CONSTRAINT "library_authors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "library_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "library_publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_book_authors" ADD CONSTRAINT "library_book_authors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_book_authors" ADD CONSTRAINT "library_book_authors_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_book_authors" ADD CONSTRAINT "library_book_authors_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "library_authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_members" ADD CONSTRAINT "library_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_members" ADD CONSTRAINT "library_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_members" ADD CONSTRAINT "library_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "library_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reservations" ADD CONSTRAINT "library_reservations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_fines" ADD CONSTRAINT "library_fines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_fines" ADD CONSTRAINT "library_fines_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "student_library_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_fines" ADD CONSTRAINT "library_fines_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_transactions" ADD CONSTRAINT "library_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_transactions" ADD CONSTRAINT "library_transactions_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "library_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_transactions" ADD CONSTRAINT "library_transactions_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "student_library_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_transactions" ADD CONSTRAINT "library_transactions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "library_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_configs" ADD CONSTRAINT "library_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_sequences" ADD CONSTRAINT "library_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;