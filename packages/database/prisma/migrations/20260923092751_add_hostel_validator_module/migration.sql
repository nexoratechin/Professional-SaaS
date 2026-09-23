/*
  Warnings:

  - You are about to drop the column `merit_score` on the `admission_applications` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "HostelGenderType" AS ENUM ('BOYS', 'GIRLS', 'COED');

-- CreateEnum
CREATE TYPE "HostelRoomSharing" AS ENUM ('SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORM');

-- CreateEnum
CREATE TYPE "HostelBedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "HostelWardenRole" AS ENUM ('WARDEN', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "HostelComplaintCategory" AS ENUM ('MAINTENANCE', 'ELECTRICAL', 'PLUMBING', 'CLEANING', 'INFRASTRUCTURE', 'NOISE', 'FOOD', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "HostelComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HostelVisitorStatus" AS ENUM ('INSIDE', 'EXITED');

-- DropIndex
DROP INDEX "admission_applications_merit_score_idx";

-- DropIndex
DROP INDEX "fee_concessions_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_demands_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_heads_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_refunds_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_sequences_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_structure_lines_tenant_id_idx";

-- DropIndex
DROP INDEX "fee_structures_tenant_id_idx";

-- DropIndex
DROP INDEX "student_fee_assignments_tenant_id_idx";

-- AlterTable
ALTER TABLE "admission_applications" DROP COLUMN "merit_score",
ADD COLUMN     "meritScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "course_offerings" ALTER COLUMN "waitlist_capacity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "library_books" ALTER COLUMN "language" DROP NOT NULL;

-- AlterTable
ALTER TABLE "library_publishers" ALTER COLUMN "country" DROP NOT NULL;

-- AlterTable
ALTER TABLE "student_fees" ADD COLUMN     "hostel_booking_id" UUID;

-- AlterTable
ALTER TABLE "student_hostel_bookings" ADD COLUMN     "bed_id" UUID,
ADD COLUMN     "building_id" UUID,
ADD COLUMN     "floor_id" UUID,
ADD COLUMN     "hostel_id" UUID,
ADD COLUMN     "previous_booking_id" UUID,
ADD COLUMN     "room_id" UUID;

-- CreateTable
CREATE TABLE "hostels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender_type" "HostelGenderType" NOT NULL DEFAULT 'COED',
    "warden_user_id" UUID,
    "description" TEXT,
    "fee_head_id" UUID,
    "charge_rent_on_check_in" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_buildings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hostel_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_floors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "floor_number" INTEGER NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hostel_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "sharing" "HostelRoomSharing" NOT NULL DEFAULT 'SINGLE',
    "bed_capacity" INTEGER NOT NULL DEFAULT 1,
    "monthly_rent_cents" INTEGER NOT NULL DEFAULT 0,
    "has_attached_bath" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_beds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "HostelBedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "monthly_rent_cents" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "hostel_beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_wardens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "HostelWardenRole" NOT NULL DEFAULT 'WARDEN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostel_wardens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_complaints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "student_id" UUID,
    "room_id" UUID,
    "category" "HostelComplaintCategory" NOT NULL,
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "HostelComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigned_to_user_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "resolved_by_user_id" UUID,
    "resolution_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostel_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hostel_visitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "id_proof_type" TEXT,
    "id_proof_number" TEXT,
    "purpose" TEXT,
    "student_id" UUID,
    "visitor_label" TEXT,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "status" "HostelVisitorStatus" NOT NULL DEFAULT 'INSIDE',
    "recorded_by_user_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hostel_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hostels_tenant_id_idx" ON "hostels"("tenant_id");

-- CreateIndex
CREATE INDEX "hostels_campus_id_idx" ON "hostels"("campus_id");

-- CreateIndex
CREATE INDEX "hostels_tenant_id_deleted_at_idx" ON "hostels"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hostels_tenant_id_campus_id_code_key" ON "hostels"("tenant_id", "campus_id", "code");

-- CreateIndex
CREATE INDEX "hostel_buildings_tenant_id_idx" ON "hostel_buildings"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_buildings_hostel_id_idx" ON "hostel_buildings"("hostel_id");

-- CreateIndex
CREATE INDEX "hostel_buildings_tenant_id_deleted_at_idx" ON "hostel_buildings"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_buildings_tenant_id_hostel_id_code_key" ON "hostel_buildings"("tenant_id", "hostel_id", "code");

-- CreateIndex
CREATE INDEX "hostel_floors_tenant_id_idx" ON "hostel_floors"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_floors_building_id_idx" ON "hostel_floors"("building_id");

-- CreateIndex
CREATE INDEX "hostel_floors_tenant_id_deleted_at_idx" ON "hostel_floors"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_floors_tenant_id_building_id_floor_number_key" ON "hostel_floors"("tenant_id", "building_id", "floor_number");

-- CreateIndex
CREATE INDEX "hostel_rooms_tenant_id_idx" ON "hostel_rooms"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_rooms_floor_id_idx" ON "hostel_rooms"("floor_id");

-- CreateIndex
CREATE INDEX "hostel_rooms_tenant_id_deleted_at_idx" ON "hostel_rooms"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_rooms_tenant_id_floor_id_code_key" ON "hostel_rooms"("tenant_id", "floor_id", "code");

-- CreateIndex
CREATE INDEX "hostel_beds_tenant_id_idx" ON "hostel_beds"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_beds_room_id_idx" ON "hostel_beds"("room_id");

-- CreateIndex
CREATE INDEX "hostel_beds_tenant_id_status_idx" ON "hostel_beds"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "hostel_beds_tenant_id_deleted_at_idx" ON "hostel_beds"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_beds_tenant_id_room_id_code_key" ON "hostel_beds"("tenant_id", "room_id", "code");

-- CreateIndex
CREATE INDEX "hostel_wardens_tenant_id_idx" ON "hostel_wardens"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_wardens_hostel_id_idx" ON "hostel_wardens"("hostel_id");

-- CreateIndex
CREATE INDEX "hostel_wardens_user_id_idx" ON "hostel_wardens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hostel_wardens_tenant_id_hostel_id_user_id_role_key" ON "hostel_wardens"("tenant_id", "hostel_id", "user_id", "role");

-- CreateIndex
CREATE INDEX "hostel_complaints_tenant_id_idx" ON "hostel_complaints"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_complaints_hostel_id_idx" ON "hostel_complaints"("hostel_id");

-- CreateIndex
CREATE INDEX "hostel_complaints_student_id_idx" ON "hostel_complaints"("student_id");

-- CreateIndex
CREATE INDEX "hostel_complaints_tenant_id_status_idx" ON "hostel_complaints"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "hostel_visitors_tenant_id_idx" ON "hostel_visitors"("tenant_id");

-- CreateIndex
CREATE INDEX "hostel_visitors_hostel_id_idx" ON "hostel_visitors"("hostel_id");

-- CreateIndex
CREATE INDEX "hostel_visitors_student_id_idx" ON "hostel_visitors"("student_id");

-- CreateIndex
CREATE INDEX "hostel_visitors_tenant_id_status_idx" ON "hostel_visitors"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "admission_applications_meritScore_idx" ON "admission_applications"("meritScore");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_hostel_id_idx" ON "student_hostel_bookings"("hostel_id");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_room_id_idx" ON "student_hostel_bookings"("room_id");

-- CreateIndex
CREATE INDEX "student_hostel_bookings_bed_id_idx" ON "student_hostel_bookings"("bed_id");

-- AddForeignKey
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_hostel_booking_id_fkey" FOREIGN KEY ("hostel_booking_id") REFERENCES "student_hostel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_fee_head_id_fkey" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_buildings" ADD CONSTRAINT "hostel_buildings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_buildings" ADD CONSTRAINT "hostel_buildings_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_floors" ADD CONSTRAINT "hostel_floors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_floors" ADD CONSTRAINT "hostel_floors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "hostel_buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "hostel_floors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hostel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_wardens" ADD CONSTRAINT "hostel_wardens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_wardens" ADD CONSTRAINT "hostel_wardens_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_complaints" ADD CONSTRAINT "hostel_complaints_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hostel_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_visitors" ADD CONSTRAINT "hostel_visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_visitors" ADD CONSTRAINT "hostel_visitors_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hostel_visitors" ADD CONSTRAINT "hostel_visitors_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "hostel_buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "hostel_floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hostel_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "hostel_beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_hostel_bookings" ADD CONSTRAINT "student_hostel_bookings_previous_booking_id_fkey" FOREIGN KEY ("previous_booking_id") REFERENCES "student_hostel_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "attendance_device_users_tenant_id_device_id_external_person_id_" RENAME TO "attendance_device_users_tenant_id_device_id_external_person_key";

-- RenameIndex
ALTER INDEX "course_offering_faculty_tenant_id_course_offering_id_user_id_ke" RENAME TO "course_offering_faculty_tenant_id_course_offering_id_user_i_key";

-- RenameIndex
ALTER INDEX "course_registrations_tenant_id_student_id_course_offering_id_ke" RENAME TO "course_registrations_tenant_id_student_id_course_offering_i_key";

-- RenameIndex
ALTER INDEX "curriculum_courses_tenant_id_curriculum_version_id_course_id_ke" RENAME TO "curriculum_courses_tenant_id_curriculum_version_id_course_i_key";

-- RenameIndex
ALTER INDEX "student_enrollments_tenant_id_student_id_academic_year_id_progr" RENAME TO "student_enrollments_tenant_id_student_id_academic_year_id_p_key";

-- RenameIndex
ALTER INDEX "student_fee_assignments_tenant_id_student_id_structure_id_term_" RENAME TO "student_fee_assignments_tenant_id_student_id_structure_id_t_key";

-- RenameIndex
ALTER INDEX "timetable_entries_tenant_id_timetable_id_period_id_day_of_week_" RENAME TO "timetable_entries_tenant_id_timetable_id_period_id_day_of_w_idx";

-- RenameIndex
ALTER INDEX "timetable_substitutions_tenant_id_substitute_user_id_effective_" RENAME TO "timetable_substitutions_tenant_id_substitute_user_id_effect_idx";
