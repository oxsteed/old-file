-- 833_settings_change_apply_dead_letter.sql
-- ADM-131: the settings-change applier retried poisoned rows every minute
-- forever, spamming the admin audit log. Track consecutive apply attempts
-- and dead-letter a row to the new terminal 'failed' status after
-- MAX_APPLY_ATTEMPTS (10) failures so the worker stops retrying it.
-- The status CHECK was created inline in migration 606, so its name is the
-- Postgres auto-name settings_change_requests_status_check.

ALTER TABLE settings_change_requests
  ADD COLUMN IF NOT EXISTS apply_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings_change_requests
  ADD COLUMN IF NOT EXISTS apply_last_error TEXT;

DO $$
BEGIN
  ALTER TABLE settings_change_requests DROP CONSTRAINT IF EXISTS settings_change_requests_status_check;
  ALTER TABLE settings_change_requests
    ADD CONSTRAINT settings_change_requests_status_check
    CHECK (status IN ('proposed', 'approved', 'rejected', 'scheduled', 'applied', 'cancelled', 'failed'));
END $$;
