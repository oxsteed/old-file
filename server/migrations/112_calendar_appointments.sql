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
  job_id                      UUID         REFERENCES jobs(id) ON DELETE SET NULL,
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
