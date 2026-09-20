-- AddTimetable
-- Implements the Phase 4 Timetable module on top of Foundation/Organization (Term, Campus,
-- Room, Section) and Academics (CourseOffering, CourseOfferingFaculty):
--  * weekly timetable for a term + campus (Timetable) with its numbered period grid (TimetablePeriod)
--  * assigned sessions (TimetableEntry) anchored to a section + period + weekday, with the
--    offering's PRIMARY faculty as the default assignee
--  * non-teaching dates (TimetableHoliday)
--  * recurring faculty busy/unavailable windows (FacultyAvailability)
--  * detected collisions (TimetableConflict) — the manual entry gate plus the recheck sweep write
--    these rows; there are deliberately no unique constraints on the entry cells
--  * date-specific faculty swaps (TimetableSubstitution) and an append-only change log
--    (TimetableHistory)
-- Business rules (conflict-free generation, conflict gates, publication, substitutions) live
-- in the API module.

-- Enums --------------------------------------------------------------------------------------------------
CREATE TYPE "TimetableStatus" AS ENUM ('DRAFT','GENERATED','PUBLISHED','ARCHIVED');
CREATE TYPE "TimetableEntryType" AS ENUM ('LECTURE','LAB','TUTORIAL','OTHER');
CREATE TYPE "TimetableConflictType" AS ENUM ('ROOM','FACULTY','SECTION');
CREATE TYPE "SubstitutionStatus" AS ENUM ('REQUESTED','APPROVED','DECLINED','CANCELLED','EXECUTED');

-- Timetables ----------------------------------------------------------------------------------------------
CREATE TABLE "timetables" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "term_id" UUID NOT NULL,
  "campus_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "status" "TimetableStatus" NOT NULL DEFAULT 'DRAFT',
  "working_days" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "published_by_id" UUID,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timetables_tenant_id_code_key" ON "timetables" ("tenant_id", "code");
CREATE INDEX "timetables_tenant_id_idx" ON "timetables" ("tenant_id");
CREATE INDEX "timetables_tenant_id_term_id_idx" ON "timetables" ("tenant_id", "term_id");
CREATE INDEX "timetables_tenant_id_campus_id_idx" ON "timetables" ("tenant_id", "campus_id");
CREATE INDEX "timetables_tenant_id_status_idx" ON "timetables" ("tenant_id", "status");
CREATE INDEX "timetables_tenant_id_deleted_at_idx" ON "timetables" ("tenant_id", "deleted_at");

ALTER TABLE "timetables"
  ADD CONSTRAINT "timetables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetables"
  ADD CONSTRAINT "timetables_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetables"
  ADD CONSTRAINT "timetables_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetables"
  ADD CONSTRAINT "timetables_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Period grid ---------------------------------------------------------------------------------------------
CREATE TABLE "timetable_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "is_break" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "timetable_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timetable_periods_timetable_id_sequence_key" ON "timetable_periods" ("timetable_id", "sequence");
CREATE INDEX "timetable_periods_tenant_id_timetable_id_idx" ON "timetable_periods" ("tenant_id", "timetable_id");

ALTER TABLE "timetable_periods"
  ADD CONSTRAINT "timetable_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_periods"
  ADD CONSTRAINT "timetable_periods_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Entries -------------------------------------------------------------------------------------------------
CREATE TABLE "timetable_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "period_id" UUID NOT NULL,
  "day_of_week" INTEGER NOT NULL,
  "course_offering_id" UUID,
  "section_id" UUID,
  "assigned_user_id" UUID,
  "room_id" UUID,
  "entry_type" "TimetableEntryType" NOT NULL DEFAULT 'LECTURE',
  "title" TEXT,
  "notes" TEXT,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timetable_entries_tenant_id_timetable_id_idx" ON "timetable_entries" ("tenant_id", "timetable_id");
CREATE INDEX "timetable_entries_tenant_id_timetable_id_day_of_week_idx" ON "timetable_entries" ("tenant_id", "timetable_id", "day_of_week");
CREATE INDEX "timetable_entries_tenant_id_timetable_id_period_id_day_of_week_idx" ON "timetable_entries" ("tenant_id", "timetable_id", "period_id", "day_of_week");
CREATE INDEX "timetable_entries_tenant_id_section_id_day_of_week_idx" ON "timetable_entries" ("tenant_id", "section_id", "day_of_week");
CREATE INDEX "timetable_entries_tenant_id_assigned_user_id_day_of_week_idx" ON "timetable_entries" ("tenant_id", "assigned_user_id", "day_of_week");
CREATE INDEX "timetable_entries_tenant_id_room_id_day_of_week_idx" ON "timetable_entries" ("tenant_id", "room_id", "day_of_week");

ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "timetable_periods" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timetable_entries"
  ADD CONSTRAINT "timetable_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Holidays ------------------------------------------------------------------------------------------------
CREATE TABLE "timetable_holidays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "timetable_holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timetable_holidays_timetable_id_date_key" ON "timetable_holidays" ("timetable_id", "date");
CREATE INDEX "timetable_holidays_tenant_id_timetable_id_idx" ON "timetable_holidays" ("tenant_id", "timetable_id");

ALTER TABLE "timetable_holidays"
  ADD CONSTRAINT "timetable_holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_holidays"
  ADD CONSTRAINT "timetable_holidays_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Faculty availability ------------------------------------------------------------------------------------
CREATE TABLE "faculty_availability" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "term_id" UUID,
  "campus_id" UUID,
  "day_of_week" INTEGER NOT NULL,
  "start_time" TEXT NOT NULL,
  "end_time" TEXT NOT NULL,
  "is_blocked" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "faculty_availability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "faculty_availability_tenant_id_user_id_idx" ON "faculty_availability" ("tenant_id", "user_id");
CREATE INDEX "faculty_availability_tenant_id_term_id_idx" ON "faculty_availability" ("tenant_id", "term_id");
CREATE INDEX "faculty_availability_tenant_id_campus_id_idx" ON "faculty_availability" ("tenant_id", "campus_id");

ALTER TABLE "faculty_availability"
  ADD CONSTRAINT "faculty_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "faculty_availability"
  ADD CONSTRAINT "faculty_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conflicts -----------------------------------------------------------------------------------------------
CREATE TABLE "timetable_conflicts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "conflict_type" "TimetableConflictType" NOT NULL,
  "day_of_week" INTEGER NOT NULL,
  "period_id" UUID,
  "entry_a_id" UUID,
  "entry_b_id" UUID,
  "substitution_a_id" UUID,
  "substitution_b_id" UUID,
  "description" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'sweep',
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" UUID,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "timetable_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timetable_conflicts_tenant_id_timetable_id_idx" ON "timetable_conflicts" ("tenant_id", "timetable_id");
CREATE INDEX "timetable_conflicts_tenant_id_timetable_id_resolved_at_idx" ON "timetable_conflicts" ("tenant_id", "timetable_id", "resolved_at");
CREATE INDEX "timetable_conflicts_tenant_id_entry_a_id_idx" ON "timetable_conflicts" ("tenant_id", "entry_a_id");
CREATE INDEX "timetable_conflicts_tenant_id_entry_b_id_idx" ON "timetable_conflicts" ("tenant_id", "entry_b_id");

ALTER TABLE "timetable_conflicts"
  ADD CONSTRAINT "timetable_conflicts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_conflicts"
  ADD CONSTRAINT "timetable_conflicts_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Substitutions -------------------------------------------------------------------------------------------
CREATE TABLE "timetable_substitutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "original_user_id" UUID,
  "substitute_user_id" UUID NOT NULL,
  "effective_date" DATE NOT NULL,
  "reason" TEXT,
  "status" "SubstitutionStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by_id" UUID,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "timetable_substitutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timetable_substitutions_tenant_id_entry_id_effective_date_key" ON "timetable_substitutions" ("tenant_id", "entry_id", "effective_date");
CREATE INDEX "timetable_substitutions_tenant_id_timetable_id_status_idx" ON "timetable_substitutions" ("tenant_id", "timetable_id", "status");
CREATE INDEX "timetable_substitutions_tenant_id_substitute_user_id_effective_date_idx" ON "timetable_substitutions" ("tenant_id", "substitute_user_id", "effective_date");

ALTER TABLE "timetable_substitutions"
  ADD CONSTRAINT "timetable_substitutions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_substitutions"
  ADD CONSTRAINT "timetable_substitutions_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timetable_substitutions"
  ADD CONSTRAINT "timetable_substitutions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "timetable_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timetable_substitutions"
  ADD CONSTRAINT "timetable_substitutions_substitute_user_id_fkey" FOREIGN KEY ("substitute_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History -------------------------------------------------------------------------------------------------
CREATE TABLE "timetable_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "timetable_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "actor_id" UUID,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "timetable_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timetable_history_tenant_id_timetable_id_idx" ON "timetable_history" ("tenant_id", "timetable_id");
CREATE INDEX "timetable_history_tenant_id_timetable_id_created_at_idx" ON "timetable_history" ("tenant_id", "timetable_id", "created_at");

ALTER TABLE "timetable_history"
  ADD CONSTRAINT "timetable_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_history"
  ADD CONSTRAINT "timetable_history_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables" ("id") ON DELETE CASCADE ON UPDATE CASCADE;