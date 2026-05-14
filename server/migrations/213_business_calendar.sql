-- Migration 213: Per-business calendar
--
-- 1. Adds business_id (nullable) to the existing `appointments` table so
--    customer-facing bookings can be reported against a specific business when
--    one is involved (the owner's business, the manager's business, etc.).
--    Existing appointments stay unchanged - business_id is opt-in.
--
-- 2. Creates `business_events` for the events a business needs that are NOT
--    customer-facing appointments: team meetings, deliveries, supplier visits,
--    vehicle maintenance, training, marketing tasks, holidays, etc. These have
--    a category, optional assignee (a business member), optional location, and
--    a colour for fast visual scanning.
--
-- Both tables are read by `GET /api/businesses/:id/calendar` and combined into
-- a single feed.

-- ─── 1. appointments.business_id (nullable, FK SET NULL) ──────────────────────
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS business_id INTEGER NULL
  REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_business_id
  ON appointments(business_id)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_business_start
  ON appointments(business_id, scheduled_start_time)
  WHERE business_id IS NOT NULL;

COMMENT ON COLUMN appointments.business_id IS
  'Optional FK to businesses(id) so per-business calendars can include the customer-facing bookings tied to a specific business.';

-- ─── 2. business_events (internal business calendar) ──────────────────────────
CREATE TABLE IF NOT EXISTS business_events (
  id              BIGSERIAL    PRIMARY KEY,
  business_id     INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by      UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignee_id     UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Categorisation for filtering + colour-coding on the calendar
  category        VARCHAR(40)  NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'team_meeting',
      'delivery',
      'supplier_visit',
      'vehicle_maintenance',
      'training',
      'marketing',
      'inspection',
      'site_visit',
      'admin',
      'holiday',
      'time_off',
      'other'
    )),

  title           VARCHAR(200) NOT NULL,
  description     TEXT         NULL,
  location        VARCHAR(255) NULL,

  -- Scheduling
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ  NOT NULL,
  all_day         BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Visual / status
  color           VARCHAR(20)  NULL,   -- optional hex / token override
  status          VARCHAR(20)  NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),

  -- Reminders + recurrence stay simple in v1
  remind_minutes  INTEGER      NULL CHECK (remind_minutes BETWEEN 0 AND 10080),
  recurrence      VARCHAR(20)  NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'biweekly', 'monthly')),

  -- Linkage to existing records (jobs, invoices, appointments)
  related_job_id          UUID    NULL REFERENCES jobs(id)         ON DELETE SET NULL,
  related_invoice_id      BIGINT  NULL,
  related_appointment_id  BIGINT  NULL REFERENCES appointments(id) ON DELETE SET NULL,

  -- Soft delete
  deleted_at      TIMESTAMPTZ  NULL,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT business_events_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_business_events_business
  ON business_events(business_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_events_business_range
  ON business_events(business_id, starts_at, ends_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_events_assignee
  ON business_events(assignee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_events_category
  ON business_events(business_id, category)
  WHERE deleted_at IS NULL;

-- updated_at trigger (reuse existing helper if available, otherwise create one)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_business_events_updated_at'
  ) THEN
    CREATE FUNCTION set_business_events_updated_at() RETURNS trigger AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_business_events_updated_at'
  ) THEN
    CREATE TRIGGER trg_business_events_updated_at
      BEFORE UPDATE ON business_events
      FOR EACH ROW
      EXECUTE FUNCTION set_business_events_updated_at();
  END IF;
END $$;

COMMENT ON TABLE business_events IS
  'Internal calendar events for a business (team meetings, deliveries, vehicle maintenance, holidays). Customer-facing bookings live in `appointments` and are joined into the same feed via appointments.business_id.';
