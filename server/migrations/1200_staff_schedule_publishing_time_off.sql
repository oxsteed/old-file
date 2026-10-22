-- Migration 1200: S-04 schedule publishing + time-off/PTO requests.
--
-- Schedule publishing: business_staff_shifts gains published_at /
-- published_by. New rows are drafts (published_at IS NULL) until a
-- manager publishes them; publishing notifies the assigned staff
-- (S-17) and makes the shifts visible to non-managers and to the
-- booking slot engine. Legacy rows backfill to published_at =
-- created_at because they went live the moment they were created.
--
-- Time-off/PTO: business_time_off_requests holds member requests with
-- a manager approve/deny workflow. Approved ranges are surfaced as
-- conflicts when a manager builds a schedule.
--
-- Additive only. Idempotent.

-- ── Schedule publishing columns ──────────────────────────────────────
ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Legacy shifts were live on creation: backfill them to published.
UPDATE business_staff_shifts
   SET published_at = created_at
 WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bss_published
  ON business_staff_shifts (business_id, published_at)
  WHERE published_at IS NULL;

-- ── Time-off / PTO requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_time_off_requests (
  id            BIGSERIAL PRIMARY KEY,
  business_id   INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT      REFERENCES food_restaurants(id) ON DELETE SET NULL,
  request_type  VARCHAR(24) NOT NULL DEFAULT 'vacation'
    CHECK (request_type IN ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  reason        TEXT,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'withdrawn')),
  decided_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_time_off_requests_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_btor_business_user
  ON business_time_off_requests (business_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_btor_business_dates
  ON business_time_off_requests (business_id, start_date, end_date)
  WHERE status IN ('pending', 'approved');
