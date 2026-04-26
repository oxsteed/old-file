-- Migration 107: Consultant availability and scheduling system
-- Note: replaces and supersedes the legacy `consultant_availability` table created in 103.
-- The 103 version was tied to consultants.id (BIGINT); this version is tied directly to users.id (UUID).

DROP TABLE IF EXISTS consultant_availability CASCADE;

-- Table to store consultant availability time slots
CREATE TABLE consultant_availability (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday..6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (consultant_id, day_of_week)
);

-- Table to store blocked dates (holidays, days off)
CREATE TABLE IF NOT EXISTS consultant_blocked_dates (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (consultant_id, blocked_date)
);

-- Table to store time slot preferences (for specific dates with custom hours)
CREATE TABLE IF NOT EXISTS consultant_schedule_exceptions (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  start_time TIME,       -- NULL means blocked all day
  end_time TIME,         -- NULL means blocked all day
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add consultant_assigned_id and missing scheduling columns to consulting_sessions_scheduled.
-- The base table is created in migration 103 with session_id, scheduled_date, scheduled_time, etc.
-- We add a direct consultant FK and a meeting_link alias used by the new scheduling controller.
ALTER TABLE consulting_sessions_scheduled
  ADD COLUMN IF NOT EXISTS consultant_assigned_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(512),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_consultant_availability_consultant_id
  ON consultant_availability(consultant_id, day_of_week, is_active);

CREATE INDEX IF NOT EXISTS idx_consultant_blocked_dates_consultant_id
  ON consultant_blocked_dates(consultant_id, blocked_date);

CREATE INDEX IF NOT EXISTS idx_consultant_schedule_exceptions_consultant_id
  ON consultant_schedule_exceptions(consultant_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_consulting_sessions_scheduled_consultant_date
  ON consulting_sessions_scheduled(consultant_assigned_id, scheduled_date);

-- Function: get consultant available slots for a given date.
CREATE OR REPLACE FUNCTION get_consultant_available_slots(
  p_consultant_id UUID,
  p_target_date DATE,
  p_slot_duration_minutes INT DEFAULT 60
)
RETURNS TABLE (
  slot_start TIME,
  slot_end TIME,
  is_available BOOLEAN
) AS $$
DECLARE
  v_day_of_week INT;
  v_start_time TIME;
  v_end_time TIME;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_target_date)::INT;

  -- Schedule exception takes priority
  SELECT cse.start_time, cse.end_time
  INTO v_start_time, v_end_time
  FROM consultant_schedule_exceptions cse
  WHERE cse.consultant_id = p_consultant_id
    AND cse.exception_date = p_target_date
  LIMIT 1;

  IF FOUND THEN
    IF v_start_time IS NULL THEN
      RETURN;
    END IF;
    RETURN QUERY
    SELECT s::TIME,
           (s + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
           TRUE
    FROM generate_series(
      v_start_time,
      v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
      (p_slot_duration_minutes || ' minutes')::INTERVAL
    ) AS s;
    RETURN;
  END IF;

  -- Fully blocked date
  IF EXISTS (
    SELECT 1 FROM consultant_blocked_dates
    WHERE consultant_id = p_consultant_id AND blocked_date = p_target_date
  ) THEN
    RETURN;
  END IF;

  -- Recurring availability for this day of week
  SELECT ca.start_time, ca.end_time
  INTO v_start_time, v_end_time
  FROM consultant_availability ca
  WHERE ca.consultant_id = p_consultant_id
    AND ca.day_of_week = v_day_of_week
    AND ca.is_active = TRUE
  LIMIT 1;

  IF v_start_time IS NOT NULL THEN
    RETURN QUERY
    SELECT s::TIME,
           (s + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
           TRUE
    FROM generate_series(
      v_start_time,
      v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
      (p_slot_duration_minutes || ' minutes')::INTERVAL
    ) AS s;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: check if a specific time slot is available (not booked).
CREATE OR REPLACE FUNCTION is_time_slot_available(
  p_consultant_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM consulting_sessions_scheduled
    WHERE consultant_assigned_id = p_consultant_id
      AND scheduled_date = p_date
      AND scheduled_time < p_end_time
      AND (scheduled_time + (duration_minutes || ' minutes')::INTERVAL)::TIME > p_start_time
      AND status IN ('confirmed', 'completed')
  );
END;
$$ LANGUAGE plpgsql;
