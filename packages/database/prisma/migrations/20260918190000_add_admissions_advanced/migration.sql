-- AddAdmissionsAdvanced
-- Extends the admissions lifecycle with:
--  * configurable session form fields (AdmissionFormField)
--  * per-program eligibility rules (AdmissionEligibilityRule)
--  * applicant communication thread (AdmissionMessage)
--  * application duplicate marking + merit score breakdown

-- AdmissionApplication: score breakdown + duplicate self-reference --------------------------------
ALTER TABLE "admission_applications"
  ADD COLUMN "score_breakdown" JSONB,
  ADD COLUMN "duplicate_of_id" UUID;

ALTER TABLE "admission_applications"
  ADD CONSTRAINT "admission_applications_duplicate_of_id_fkey"
  FOREIGN KEY ("duplicate_of_id") REFERENCES "admission_applications" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "admission_applications_duplicate_of_id_idx" ON "admission_applications" ("duplicate_of_id");

-- Configurable admission form fields ----------------------------------------------------------------
CREATE TYPE "AdmissionFieldType" AS ENUM ('TEXT','TEXTAREA','NUMBER','DATE','EMAIL','PHONE','SELECT','RADIO','CHECKBOX');

CREATE TABLE "admission_form_fields" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "field_type" "AdmissionFieldType" NOT NULL,
  "placeholder" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" JSONB,
  "help_text" TEXT,
  "sequence_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admission_form_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admission_form_fields_tenant_id_session_id_code_key"
  ON "admission_form_fields" ("tenant_id", "session_id", "code");
CREATE INDEX "admission_form_fields_tenant_id_idx" ON "admission_form_fields" ("tenant_id");
CREATE INDEX "admission_form_fields_session_id_idx" ON "admission_form_fields" ("session_id");

ALTER TABLE "admission_form_fields"
  ADD CONSTRAINT "admission_form_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admission_form_fields"
  ADD CONSTRAINT "admission_form_fields_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "admission_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Eligibility rules -----------------------------------------------------------------------------------
CREATE TYPE "AdmissionEligibilityRuleType" AS ENUM ('MIN_PERCENTAGE','MIN_GPA','MIN_MARKS','MIN_AGE','MAX_AGE','CATEGORY_ALLOWED','CUSTOM');

CREATE TABLE "admission_eligibility_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "program_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rule_type" "AdmissionEligibilityRuleType" NOT NULL,
  "config" JSONB,
  "applies_to_category" TEXT,
  "sequence_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admission_eligibility_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_eligibility_rules_tenant_id_idx" ON "admission_eligibility_rules" ("tenant_id");
CREATE INDEX "admission_eligibility_rules_program_id_idx" ON "admission_eligibility_rules" ("program_id");
CREATE INDEX "admission_eligibility_rules_tenant_id_is_active_idx" ON "admission_eligibility_rules" ("tenant_id", "is_active");

ALTER TABLE "admission_eligibility_rules"
  ADD CONSTRAINT "admission_eligibility_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admission_eligibility_rules"
  ADD CONSTRAINT "admission_eligibility_rules_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "admission_program_offers" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdmissionMessage ↔ Application; applicant communication thread ------------------------------------
CREATE TYPE "AdmissionMessageChannel" AS ENUM ('EMAIL','SMS','IN_APP');

CREATE TABLE "admission_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "channel" "AdmissionMessageChannel" NOT NULL,
  "sent_by" UUID,
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "related_notification_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admission_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admission_messages_tenant_id_idx" ON "admission_messages" ("tenant_id");
CREATE INDEX "admission_messages_application_id_idx" ON "admission_messages" ("application_id");
CREATE INDEX "admission_messages_application_id_sent_at_idx" ON "admission_messages" ("application_id", "sent_at");

ALTER TABLE "admission_messages"
  ADD CONSTRAINT "admission_messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admission_messages"
  ADD CONSTRAINT "admission_messages_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "admission_applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE;