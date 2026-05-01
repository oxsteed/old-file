
-- >>> BEGIN: 112_calendar_appointments.sql <<<
-- ═══════════════════════════════════════════════════════════════
-- Migration 112: Calendar appointments + availability + notifications
--
-- IMPORTANT: All FK columns referencing users(id) and jobs(id) must be UUID.
-- Earlier drafts of this file used BIGINT, which fails with "foreign key
-- constraint cannot be implemented" because PostgreSQL cannot create a FK
-- between BIGINT and UUID (no shared operator class).
--
-- The migration runner (migrate.js) wraps each file in a single client.query()
-- so any error rolls everything back. We therefore do NOT need per-statement
-- exception handling. We DO drop any partial state from prior failed attempts
-- to ensure a clean slate even if a previous deploy left orphaned tables.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Drop any partial state from earlier failed deploys
DROP TABLE IF EXISTS calendar_audit_log     CASCADE;
DROP TABLE IF EXISTS calendar_notifications CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS availability_blocks    CASCADE;
DROP TABLE IF EXISTS appointments           CASCADE;

-- ─── APPOINTMENTS ────────────────────────────────────────────
CREATE TABLE appointments (
  id                          BIGSERIAL    PRIMARY KEY,
  customer_id                 UUID         NOT NULL
                                             REFERENCES users(id) ON DELETE CASCADE,
  helper_id                   UUID         NOT NULL
                                             REFERENCES users(id) ON DELETE CASCADE,
  job_id                      UUID,
  service_description         TEXT         NOT NULL,
  scheduled_start_time        TIMESTAMPTZ  NOT NULL,
  scheduled_end_time          TIMESTAMPTZ  NOT NULL,
  estimated_duration_minutes  INT          NOT NULL DEFAULT 60
                                             CHECK (estimated_duration_minutes BETWEEN 15 AND 480),
  location_address            VARCHAR(500),
  location_lat                DECIMAL(10, 7)
                                             CHECK (location_lat IS NULL OR (location_lat >= -90  AND location_lat <= 90)),
  location_lng                DECIMAL(10, 7)
                                             CHECK (location_lng IS NULL OR (location_lng >= -180 AND location_lng <= 180)),
  status                      VARCHAR(20)  NOT NULL DEFAULT 'requested'
                                             CHECK (status IN ('requested','confirmed','in_progress','completed','cancelled','rescheduled')),
  notes                       TEXT,
  customer_notes              TEXT,
  helper_notes                TEXT,
  cancellation_reason         TEXT,
  cancelled_by                VARCHAR(20)
                                             CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer','helper','admin')),
  cancelled_at                TIMESTAMPTZ,
  rescheduled_from_id         BIGINT       REFERENCES appointments(id) ON DELETE SET NULL,
  -- created_by_user_id is nullable (ON DELETE SET NULL) so the appointment row
  -- survives if the creator is later deleted; the customer/helper FKs already
  -- enforce that the relationship as a whole disappears via CASCADE.
  created_by_user_id          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (scheduled_end_time > scheduled_start_time)
);

CREATE INDEX idx_appointments_customer        ON appointments(customer_id);
CREATE INDEX idx_appointments_helper          ON appointments(helper_id);
CREATE INDEX idx_appointments_job             ON appointments(job_id);
CREATE INDEX idx_appointments_status          ON appointments(status);
CREATE INDEX idx_appointments_start           ON appointments(scheduled_start_time);
CREATE INDEX idx_appointments_customer_status ON appointments(customer_id, status);
CREATE INDEX idx_appointments_helper_status   ON appointments(helper_id, status);
-- Partial index used by conflict checks (only "live" appointments are checked)
CREATE INDEX idx_appointments_helper_active_window
  ON appointments(helper_id, scheduled_start_time, scheduled_end_time)
  WHERE status IN ('requested','confirmed','in_progress');

-- ─── AVAILABILITY BLOCKS (helper-managed) ────────────────────
CREATE TABLE availability_blocks (
  id              BIGSERIAL    PRIMARY KEY,
  helper_id       UUID         NOT NULL
                                 REFERENCES users(id) ON DELETE CASCADE,
  start_time      TIMESTAMPTZ  NOT NULL,
  end_time        TIMESTAMPTZ  NOT NULL,
  type            VARCHAR(20)  NOT NULL DEFAULT 'available'
                                 CHECK (type IN ('available','unavailable','busy')),
  recurring_rule  VARCHAR(255),
  recurring_until TIMESTAMPTZ,
  title           VARCHAR(255),
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_avail_blocks_helper      ON availability_blocks(helper_id);
CREATE INDEX idx_avail_blocks_start       ON availability_blocks(start_time);
CREATE INDEX idx_avail_blocks_end         ON availability_blocks(end_time);
CREATE INDEX idx_avail_blocks_helper_window
  ON availability_blocks(helper_id, start_time, end_time);

-- ─── CALENDAR NOTIFICATIONS ──────────────────────────────────
CREATE TABLE calendar_notifications (
  id                 BIGSERIAL    PRIMARY KEY,
  user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id     BIGINT       NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  notification_type  VARCHAR(30)  NOT NULL CHECK (notification_type IN (
    'appointment_requested',
    'appointment_confirmed',
    'appointment_cancelled',
    'appointment_rescheduled',
    'reminder_24h',
    'reminder_2h',
    'reminder_same_day',
    'appointment_completed'
  )),
  channel            VARCHAR(20)  NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  scheduled_send_at  TIMESTAMPTZ  NOT NULL,
  sent_at            TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ,
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','sent','failed','cancelled')),
  error_message      TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_cal_notif_user         ON calendar_notifications(user_id);
CREATE INDEX idx_cal_notif_appointment  ON calendar_notifications(appointment_id);
CREATE INDEX idx_cal_notif_status       ON calendar_notifications(status);
CREATE INDEX idx_cal_notif_due
  ON calendar_notifications(scheduled_send_at)
  WHERE status = 'pending';
CREATE INDEX idx_cal_notif_user_status  ON calendar_notifications(user_id, status);

-- ─── NOTIFICATION PREFERENCES (per user) ─────────────────────
CREATE TABLE notification_preferences (
  id                              BIGSERIAL    PRIMARY KEY,
  user_id                         UUID         NOT NULL UNIQUE
                                                 REFERENCES users(id) ON DELETE CASCADE,
  appointment_confirmed_channels  TEXT[]       NOT NULL DEFAULT ARRAY['in_app','email']::text[],
  appointment_cancelled_channels  TEXT[]       NOT NULL DEFAULT ARRAY['in_app','email']::text[],
  reminder_24h_channels           TEXT[]       NOT NULL DEFAULT ARRAY['in_app','email']::text[],
  reminder_2h_channels            TEXT[]       NOT NULL DEFAULT ARRAY['in_app']::text[],
  reminder_same_day_channels      TEXT[]       NOT NULL DEFAULT ARRAY['in_app','sms']::text[],
  quiet_hours_start               TIME,
  quiet_hours_end                 TIME,
  timezone                        VARCHAR(50)  NOT NULL DEFAULT 'UTC',
  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_prefs_user ON notification_preferences(user_id);

-- ─── CALENDAR AUDIT LOG ──────────────────────────────────────
CREATE TABLE calendar_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id  BIGINT       REFERENCES appointments(id) ON DELETE SET NULL,
  action          VARCHAR(50)  NOT NULL,
  details         JSONB,
  ip_hash         VARCHAR(64),
  user_agent_hash VARCHAR(64),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_cal_audit_user        ON calendar_audit_log(user_id);
CREATE INDEX idx_cal_audit_appointment ON calendar_audit_log(appointment_id);
CREATE INDEX idx_cal_audit_created     ON calendar_audit_log(created_at DESC);

-- ─── FK: appointments → jobs (added post-CREATE to survive missing jobs table) ─
-- Uses exception handling so the migration succeeds even when the jobs table
-- has not been created yet (e.g. fresh DB where an earlier migration failed).
-- The duplicate_object branch makes it safe to re-run (idempotency).
DO $$
BEGIN
  ALTER TABLE appointments
    ADD CONSTRAINT fk_appointments_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END;
$$;

-- ─── updated_at TRIGGERS (re-use the helper from migration 001) ─
-- update_updated_at() is created in migration 001_initial_schema.sql.
CREATE TRIGGER trg_appointments_updated
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_availability_blocks_updated
  BEFORE UPDATE ON availability_blocks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_notification_preferences_updated
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 112
-- ═══════════════════════════════════════════════════════════════

-- >>> END: 112_calendar_appointments.sql <<<

-- >>> BEGIN: 113_web_push_extensions.sql <<<
-- ─────────────────────────────────────────────────────────────
-- Migration 113: Web Push extensions
--
-- Extends the existing push_subscriptions table (created in 001
-- and amended in 025) with W3C Push API fields, fixes the phantom
-- delivery-tracking columns referenced by notificationService.js,
-- and adds a master Web Push opt-in flag on notification_preferences.
--
-- Idempotent — every change uses IF NOT EXISTS / EXCEPTION blocks
-- so it can be re-applied against partially-migrated databases.
-- ─────────────────────────────────────────────────────────────

-- ─── push_subscriptions: VAPID-shape columns ──────────────────
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS expiration_time BIGINT,
  ADD COLUMN IF NOT EXISTS device_label    TEXT,
  ADD COLUMN IF NOT EXISTS failure_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;

-- ─── notifications: delivery flags (referenced by service) ───
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_push_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_url    TEXT;

-- ─── notification_preferences: master Web Push opt-in ────────
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS web_push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS idx_push_subs_active_user
  ON push_subscriptions(user_id, active)
  WHERE active = TRUE;

-- >>> END: 113_web_push_extensions.sql <<<

-- >>> BEGIN: 114_restore_notification_prefs_columns.sql <<<
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114: Restore notification_preferences boolean columns
--
-- Migration 112 dropped the notification_preferences table (originally created
-- in migration 025) and recreated it as a calendar-specific table containing
-- only appointment/reminder channel arrays and quiet-hours settings. This
-- destroyed the per-event boolean preference columns (push_*, email_*, in_app_*)
-- that notificationController.js and notificationService.js rely on.
--
-- This migration re-adds all original columns as ADD COLUMN IF NOT EXISTS so
-- it is safe to apply against both a fresh database (112 just ran) and any
-- partially-migrated or previously-repaired state.
--
-- After this migration the table holds BOTH sets of columns:
--   • Calendar channel arrays from migration 112
--   • Per-event boolean flags restored here
--   • web_push_enabled master toggle added by migration 113
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_preferences
  -- ── In-app notification flags ────────────────────────────────
  ADD COLUMN IF NOT EXISTS in_app_new_bid          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_bid_accepted     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_job_started      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_job_completed    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_payment_released BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_new_review       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_dispute_update   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_subscription     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_new_message      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_message_mention  BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Push notification flags (Expo native + Web Push) ─────────
  ADD COLUMN IF NOT EXISTS push_new_job_nearby     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_new_bid            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_bid_accepted       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_payment_released   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_dispute_update     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_new_message        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_message_mention    BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Email notification flags ──────────────────────────────────
  ADD COLUMN IF NOT EXISTS email_bid_accepted      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_payment_released  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_subscription      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_dispute_update    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_weekly_summary    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_new_message       BOOLEAN NOT NULL DEFAULT TRUE;

-- >>> END: 114_restore_notification_prefs_columns.sql <<<

-- >>> BEGIN: 116_admin_user_action_log.sql <<<
-- Migration 116: Admin User-Action Audit Log
--
-- Per-field audit trail for super-admin and regional-admin user account
-- modifications. Complements `admin_audit_log` (general admin actions)
-- with a structured before/after row per field changed.
--
-- A single user edit may write multiple rows (one per modified field),
-- which makes filtering and export straightforward.

CREATE TABLE IF NOT EXISTS admin_user_action_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     VARCHAR(64)  NOT NULL,   -- create_user, edit_email, change_tier, etc.
  field_name      VARCHAR(100),            -- nullable for create_user
  old_value       TEXT,                    -- redacted for sensitive fields (e.g. password)
  new_value       TEXT,                    -- redacted for sensitive fields
  notes           TEXT,
  ip_address      INET,
  region_id       INTEGER REFERENCES admin_regions(id) ON DELETE SET NULL,
  user_notified   BOOLEAN      NOT NULL DEFAULT FALSE,
  notification_id BIGINT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_action_log_admin       ON admin_user_action_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_user_action_log_target      ON admin_user_action_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_user_action_log_action_type ON admin_user_action_log(action_type);
CREATE INDEX IF NOT EXISTS idx_user_action_log_created     ON admin_user_action_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_action_log_region      ON admin_user_action_log(region_id);

-- Composite for the most common filter: time + admin
CREATE INDEX IF NOT EXISTS idx_user_action_log_time_admin
  ON admin_user_action_log(created_at DESC, admin_id);

-- Forbid deletes on the audit log (matches admin_audit_log pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE tablename = 'admin_user_action_log'
      AND rulename  = 'user_action_log_no_delete'
  ) THEN
    EXECUTE 'CREATE RULE user_action_log_no_delete AS ON DELETE TO admin_user_action_log DO INSTEAD NOTHING';
  END IF;
END$$;

-- >>> END: 116_admin_user_action_log.sql <<<

-- >>> BEGIN: 117_users_international.sql <<<
-- 117_users_international.sql
-- Make the users table country-aware so the app can serve customers in any
-- region — not just the United States.
--
-- Changes:
--   1. Add `users.country` (ISO-3166 alpha-2). Default 'US' so existing rows
--      remain valid for backwards compatibility.
--   2. Widen `users.state` from VARCHAR(50) → VARCHAR(100) to fit longer
--      state/province/region names (e.g. "Provence-Alpes-Côte d'Azur").
--   3. Widen `users.zip_code` from VARCHAR(10) → VARCHAR(20) to fit non-US
--      postal codes (e.g. UK "SW1A 1AA", Canadian "M5V 3L9").
--   4. Add optional `users.preferred_currency` (ISO-4217) and `users.timezone`
--      (IANA tz database name).
--
-- Idempotent: every statement uses IF NOT EXISTS where supported, and the
-- ALTER COLUMN TYPE statements are safe to re-run.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'US';

CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);

-- Backfill any rows that ended up with NULL country before the default kicked
-- in (defensive — shouldn't happen with NOT NULL DEFAULT).
UPDATE users SET country = 'US' WHERE country IS NULL OR country = '';

-- Widen state column. Existing data fits trivially.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'state'
       AND character_maximum_length < 100
  ) THEN
    ALTER TABLE users ALTER COLUMN state TYPE VARCHAR(100);
  END IF;
END $$;

-- Widen zip_code column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'zip_code'
       AND character_maximum_length < 20
  ) THEN
    ALTER TABLE users ALTER COLUMN zip_code TYPE VARCHAR(20);
  END IF;
END $$;

-- Optional locale columns.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone           VARCHAR(64);

-- ----------------------------------------------------------------
-- pending_registrations: signup buffer needs to carry the same
-- international fields, otherwise non-US signups get truncated.
-- ----------------------------------------------------------------
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'US';

-- Widen pending_registrations.state (CHAR(2) / VARCHAR(2) historically).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'pending_registrations' AND column_name = 'state'
       AND character_maximum_length < 100
  ) THEN
    ALTER TABLE pending_registrations ALTER COLUMN state TYPE VARCHAR(100);
  END IF;
END $$;

-- Widen pending_registrations.zip_code (VARCHAR(10) historically).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'pending_registrations' AND column_name = 'zip_code'
       AND character_maximum_length < 20
  ) THEN
    ALTER TABLE pending_registrations ALTER COLUMN zip_code TYPE VARCHAR(20);
  END IF;
END $$;

-- Document the new columns.
COMMENT ON COLUMN users.country            IS 'ISO-3166 alpha-2 country code. Default ''US''.';
COMMENT ON COLUMN users.preferred_currency IS 'ISO-4217 currency code (e.g. USD, EUR, GBP).';
COMMENT ON COLUMN users.timezone           IS 'IANA timezone (e.g. America/New_York). Optional.';

COMMIT;

-- >>> END: 117_users_international.sql <<<

-- >>> BEGIN: 118_businesses_international.sql <<<
-- 118_businesses_international.sql
-- Make business addresses internationally viable.
--
-- - Adds `address_country` (ISO-2). Defaults to 'US' so existing rows continue
--   to behave as before.
-- - Widens `address_state` (was VARCHAR(50)) and `address_zip` (was VARCHAR(10))
--   so non-US regions and postal formats fit (e.g. UK postcodes, Brazilian
--   region names, free-text regions).
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS address_country VARCHAR(2);

UPDATE businesses
  SET address_country = 'US'
  WHERE address_country IS NULL;

ALTER TABLE businesses
  ALTER COLUMN address_country SET DEFAULT 'US',
  ALTER COLUMN address_country SET NOT NULL;

ALTER TABLE businesses
  ALTER COLUMN address_state TYPE VARCHAR(100),
  ALTER COLUMN address_zip   TYPE VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_businesses_address_country
  ON businesses (address_country);

COMMIT;

-- >>> END: 118_businesses_international.sql <<<
