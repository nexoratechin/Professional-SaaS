-- Offer expiry reminders for the public admissions portal.
--
-- The hourly portal sweep emails applicants whose offer is about to expire. `reminder_sent_at`
-- makes that sweep idempotent: an offer is reminded at most once, no matter how often the job runs
-- or how many worker replicas pick it up.
ALTER TABLE `admission_offers`
    ADD COLUMN `reminder_sent_at` DATETIME(3) NULL;
