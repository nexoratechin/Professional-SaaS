-- AddAcademics
-- Implements the Phase 4 Academics module on top of Foundation/Organization
-- (Program, AcademicYear, Term) and Student 360 (Student, StudentEnrollment) data:
--  * course catalog + prerequisites (Course, CoursePrerequisite)
--  * curricula with versioned course maps (Curriculum, CurriculumVersion, CurriculumCourse)
--  * course offerings with faculty assignment (CourseOffering, CourseOfferingFaculty)
--  * student course registration (CourseRegistration)
--  * academic advising (AcademicAdvisingRecord)
--  * progression/promotion + backlogs (AcademicProgressionRecord, CourseBacklog)
--  * academic calendar events (AcademicCalendarEvent)
-- Faculty are User rows (HR module not built yet); offerings/advising reference users.
-- Business rules (prerequisites, windows/capacity/waitlist, promotion) live in the API.

-- Enums --------------------------------------------------------------------------------------------------
CREATE TYPE "CourseType" AS ENUM ('CORE','ELECTIVE','OPEN_ELECTIVE','LABORATORY','PROJECT','INTERNSHIP','MINOR','OTHER');
CREATE TYPE "CurriculumVersionStatus" AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
CREATE TYPE "CourseOfferingStatus" AS ENUM ('PLANNED','ACTIVE','CLOSED','CANCELLED','COMPLETED');
CREATE TYPE "FacultyAssignmentRole" AS ENUM ('PRIMARY','CO_TEACHER','ASSISTANT');
CREATE TYPE "CourseRegistrationStatus" AS ENUM ('REGISTERED','CONFIRMED','WAITLISTED','WITHDRAWN','DROPPED','COMPLETED');
CREATE TYPE "AdvisingPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "AdvisingStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED');
CREATE TYPE "ProgressionStatus" AS ENUM ('CONTINUING','PROMOTED','REAPPEARING','DETAINED','GRADUATED','WITHDRAWN');
CREATE TYPE "BacklogStatus" AS ENUM ('OPEN','CLEARED','EXEMPTED');

-- Course catalog ------------------------------------------------------------------------------------------
CREATE TABLE "courses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "department_id" UUID,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "credit_hours" INTEGER NOT NULL DEFAULT 3,
  "course_type" "CourseType" NOT NULL DEFAULT 'CORE',
  "grading_basis" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courses_tenant_id_code_key" ON "courses" ("tenant_id", "code");
CREATE INDEX "courses_tenant_id_deleted_at_idx" ON "courses" ("tenant_id", "deleted_at");
CREATE INDEX "courses_department_id_idx" ON "courses" ("department_id");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courses"
  ADD CONSTRAINT "courses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Course prerequisites (self-relation) --------------------------------------------------------------------
CREATE TABLE "course_prerequisites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "required_course_id" UUID NOT NULL,
  "min_grade" TEXT,
  "description" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "course_prerequisites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_prerequisites_tenant_id_course_id_required_course_id_key"
  ON "course_prerequisites" ("tenant_id", "course_id", "required_course_id");
CREATE INDEX "course_prerequisites_tenant_id_idx" ON "course_prerequisites" ("tenant_id");
CREATE INDEX "course_prerequisites_required_course_id_idx" ON "course_prerequisites" ("required_course_id");

ALTER TABLE "course_prerequisites"
  ADD CONSTRAINT "course_prerequisites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_prerequisites"
  ADD CONSTRAINT "course_prerequisites_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_prerequisites"
  ADD CONSTRAINT "course_prerequisites_required_course_id_fkey" FOREIGN KEY ("required_course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Curricula -----------------------------------------------------------------------------------------------
CREATE TABLE "curricula" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "curricula_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curricula_tenant_id_code_key" ON "curricula" ("tenant_id", "code");
CREATE INDEX "curricula_tenant_id_program_id_idx" ON "curricula" ("tenant_id", "program_id");
CREATE INDEX "curricula_tenant_id_deleted_at_idx" ON "curricula" ("tenant_id", "deleted_at");

ALTER TABLE "curricula"
  ADD CONSTRAINT "curricula_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "curricula"
  ADD CONSTRAINT "curricula_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Curriculum versions -------------------------------------------------------------------------------------
CREATE TABLE "curriculum_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "curriculum_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "status" "CurriculumVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "min_total_credits" INTEGER,
  "is_current" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curriculum_versions_tenant_id_curriculum_id_version_number_key"
  ON "curriculum_versions" ("tenant_id", "curriculum_id", "version_number");
CREATE INDEX "curriculum_versions_tenant_id_curriculum_id_idx" ON "curriculum_versions" ("tenant_id", "curriculum_id");
CREATE INDEX "curriculum_versions_tenant_id_status_idx" ON "curriculum_versions" ("tenant_id", "status");

ALTER TABLE "curriculum_versions"
  ADD CONSTRAINT "curriculum_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "curriculum_versions"
  ADD CONSTRAINT "curriculum_versions_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Curriculum course maps ----------------------------------------------------------------------------------
CREATE TABLE "curriculum_courses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "curriculum_version_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "semester" INTEGER NOT NULL,
  "category" TEXT,
  "is_compulsory" BOOLEAN NOT NULL DEFAULT true,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "min_grade" TEXT,
  "credit_override" INTEGER,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "curriculum_courses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curriculum_courses_tenant_id_curriculum_version_id_course_id_key"
  ON "curriculum_courses" ("tenant_id", "curriculum_version_id", "course_id");
CREATE INDEX "curriculum_courses_tenant_id_curriculum_version_id_semester_idx"
  ON "curriculum_courses" ("tenant_id", "curriculum_version_id", "semester");
CREATE INDEX "curriculum_courses_tenant_id_course_id_idx" ON "curriculum_courses" ("tenant_id", "course_id");

ALTER TABLE "curriculum_courses"
  ADD CONSTRAINT "curriculum_courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "curriculum_courses"
  ADD CONSTRAINT "curriculum_courses_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "curriculum_courses"
  ADD CONSTRAINT "curriculum_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Course offerings ----------------------------------------------------------------------------------------
CREATE TABLE "course_offerings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "term_id" UUID NOT NULL,
  "academic_year_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "section_id" UUID,
  "batch_id" UUID,
  "campus_id" UUID,
  "code" TEXT NOT NULL,
  "credit_hours" INTEGER,
  "status" "CourseOfferingStatus" NOT NULL DEFAULT 'PLANNED',
  "mode" TEXT,
  "capacity" INTEGER,
  "waitlist_capacity" INTEGER NOT NULL DEFAULT 0,
  "enrollment_start_at" TIMESTAMP(3),
  "enrollment_end_at" TIMESTAMP(3),
  "schedule" JSONB,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_offerings_tenant_id_code_key" ON "course_offerings" ("tenant_id", "code");
CREATE INDEX "course_offerings_tenant_id_term_id_idx" ON "course_offerings" ("tenant_id", "term_id");
CREATE INDEX "course_offerings_tenant_id_course_id_idx" ON "course_offerings" ("tenant_id", "course_id");
CREATE INDEX "course_offerings_tenant_id_program_id_idx" ON "course_offerings" ("tenant_id", "program_id");
CREATE INDEX "course_offerings_tenant_id_section_id_idx" ON "course_offerings" ("tenant_id", "section_id");
CREATE INDEX "course_offerings_tenant_id_batch_id_idx" ON "course_offerings" ("tenant_id", "batch_id");
CREATE INDEX "course_offerings_tenant_id_status_idx" ON "course_offerings" ("tenant_id", "status");
CREATE INDEX "course_offerings_tenant_id_deleted_at_idx" ON "course_offerings" ("tenant_id", "deleted_at");

ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_offerings"
  ADD CONSTRAINT "course_offerings_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Faculty assignment --------------------------------------------------------------------------------------
CREATE TABLE "course_offering_faculty" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "course_offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "FacultyAssignmentRole" NOT NULL DEFAULT 'CO_TEACHER',
  "allocation_percent" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "course_offering_faculty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_offering_faculty_tenant_id_course_offering_id_user_id_key"
  ON "course_offering_faculty" ("tenant_id", "course_offering_id", "user_id");
CREATE INDEX "course_offering_faculty_tenant_id_user_id_idx" ON "course_offering_faculty" ("tenant_id", "user_id");

ALTER TABLE "course_offering_faculty"
  ADD CONSTRAINT "course_offering_faculty_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_offering_faculty"
  ADD CONSTRAINT "course_offering_faculty_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_offering_faculty"
  ADD CONSTRAINT "course_offering_faculty_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Course registrations ------------------------------------------------------------------------------------
CREATE TABLE "course_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "course_offering_id" UUID NOT NULL,
  "term_id" UUID NOT NULL,
  "status" "CourseRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
  "waitlist_position" INTEGER,
  "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by_user_id" UUID,
  "drop_reason" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "course_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_registrations_tenant_id_student_id_course_offering_id_key"
  ON "course_registrations" ("tenant_id", "student_id", "course_offering_id");
CREATE INDEX "course_registrations_tenant_id_status_idx" ON "course_registrations" ("tenant_id", "status");
CREATE INDEX "course_registrations_tenant_id_student_id_term_id_idx" ON "course_registrations" ("tenant_id", "student_id", "term_id");

ALTER TABLE "course_registrations"
  ADD CONSTRAINT "course_registrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_registrations"
  ADD CONSTRAINT "course_registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_registrations"
  ADD CONSTRAINT "course_registrations_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_registrations"
  ADD CONSTRAINT "course_registrations_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Academic advising ---------------------------------------------------------------------------------------
CREATE TABLE "academic_advising_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "advisor_user_id" UUID NOT NULL,
  "term_id" UUID,
  "session_type" TEXT NOT NULL DEFAULT 'ACADEMIC',
  "summary" TEXT NOT NULL,
  "details" TEXT,
  "action_items" TEXT,
  "priority" "AdvisingPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "AdvisingStatus" NOT NULL DEFAULT 'OPEN',
  "follow_up_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "academic_advising_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "academic_advising_records_tenant_id_student_id_idx" ON "academic_advising_records" ("tenant_id", "student_id");
CREATE INDEX "academic_advising_records_tenant_id_advisor_user_id_idx" ON "academic_advising_records" ("tenant_id", "advisor_user_id");
CREATE INDEX "academic_advising_records_tenant_id_status_idx" ON "academic_advising_records" ("tenant_id", "status");

ALTER TABLE "academic_advising_records"
  ADD CONSTRAINT "academic_advising_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_advising_records"
  ADD CONSTRAINT "academic_advising_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_advising_records"
  ADD CONSTRAINT "academic_advising_records_advisor_user_id_fkey" FOREIGN KEY ("advisor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_advising_records"
  ADD CONSTRAINT "academic_advising_records_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Academic progression / promotion ------------------------------------------------------------------------
CREATE TABLE "academic_progression_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "academic_year_id" UUID NOT NULL,
  "batch_id" UUID,
  "from_semester" INTEGER NOT NULL,
  "to_semester" INTEGER NOT NULL,
  "status" "ProgressionStatus" NOT NULL,
  "credits_earned" INTEGER,
  "credits_required" INTEGER,
  "gpa_score" DOUBLE PRECISION,
  "backlog_open" INTEGER NOT NULL DEFAULT 0,
  "backlog_cleared" INTEGER NOT NULL DEFAULT 0,
  "decision_by" UUID,
  "decided_at" TIMESTAMP(3),
  "remarks" TEXT,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "academic_progression_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "academic_progression_records_tenant_id_student_id_idx" ON "academic_progression_records" ("tenant_id", "student_id");
CREATE INDEX "academic_progression_records_tenant_id_academic_year_id_idx" ON "academic_progression_records" ("tenant_id", "academic_year_id");
CREATE INDEX "academic_progression_records_tenant_id_status_idx" ON "academic_progression_records" ("tenant_id", "status");

ALTER TABLE "academic_progression_records"
  ADD CONSTRAINT "academic_progression_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_progression_records"
  ADD CONSTRAINT "academic_progression_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "academic_progression_records"
  ADD CONSTRAINT "academic_progression_records_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_progression_records"
  ADD CONSTRAINT "academic_progression_records_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_progression_records"
  ADD CONSTRAINT "academic_progression_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Course backlogs -----------------------------------------------------------------------------------------
CREATE TABLE "course_backlogs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "registration_id" UUID,
  "term_id" UUID NOT NULL,
  "status" "BacklogStatus" NOT NULL DEFAULT 'OPEN',
  "cleared_at" TIMESTAMP(3),
  "cleared_in_registration_id" UUID,
  "remarks" TEXT,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "course_backlogs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_backlogs_tenant_id_student_id_course_id_term_id_key"
  ON "course_backlogs" ("tenant_id", "student_id", "course_id", "term_id");
CREATE INDEX "course_backlogs_tenant_id_student_id_idx" ON "course_backlogs" ("tenant_id", "student_id");
CREATE INDEX "course_backlogs_tenant_id_status_idx" ON "course_backlogs" ("tenant_id", "status");

ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "course_registrations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_backlogs"
  ADD CONSTRAINT "course_backlogs_cleared_in_registration_id_fkey" FOREIGN KEY ("cleared_in_registration_id") REFERENCES "course_registrations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Academic calendar ---------------------------------------------------------------------------------------
CREATE TABLE "academic_calendar_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "academic_year_id" UUID NOT NULL,
  "term_id" UUID,
  "event_type" TEXT NOT NULL DEFAULT 'EVENT',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "applies_to" TEXT DEFAULT 'GLOBAL',
  "color" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "academic_calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "academic_calendar_events_tenant_id_academic_year_id_idx" ON "academic_calendar_events" ("tenant_id", "academic_year_id");
CREATE INDEX "academic_calendar_events_tenant_id_event_type_idx" ON "academic_calendar_events" ("tenant_id", "event_type");
CREATE INDEX "academic_calendar_events_tenant_id_is_published_idx" ON "academic_calendar_events" ("tenant_id", "is_published");

ALTER TABLE "academic_calendar_events"
  ADD CONSTRAINT "academic_calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_calendar_events"
  ADD CONSTRAINT "academic_calendar_events_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "academic_calendar_events"
  ADD CONSTRAINT "academic_calendar_events_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms" ("id") ON DELETE SET NULL ON UPDATE CASCADE;