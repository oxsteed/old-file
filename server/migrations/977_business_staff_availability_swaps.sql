-- Migration 977: recurring staff availability and manager-approved shift swaps.
-- Availability is intentionally separate from scheduled shifts: a person may
-- publish multiple windows per day without creating a work commitment.

CREATE TABLE IF NOT EXISTS business_staff_availability (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_staff_availability_window_check CHECK (end_time > start_time),
  CONSTRAINT business_staff_availability_unique_window
    UNIQUE (business_id, user_id, day_of_week, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_business_staff_availability_lookup
  ON business_staff_availability(business_id, user_id, day_of_week, start_time);

CREATE TABLE IF NOT EXISTS business_shift_swap_requests (
  id                  BIGSERIAL PRIMARY KEY,
  business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shift_id            BIGINT NOT NULL REFERENCES business_staff_shifts(id) ON DELETE CASCADE,
  requester_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  note                TEXT,
  decided_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_shift_swap_requests_business_status
  ON business_shift_swap_requests(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_shift_swap_requests_participants
  ON business_shift_swap_requests(business_id, requester_user_id, target_user_id);
