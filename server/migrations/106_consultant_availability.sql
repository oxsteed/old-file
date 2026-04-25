-- Migration 106: Consultant availability and scheduling system

-- Table to store consultant availability time slots
CREATE TABLE consultant_availability (
  id BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
  start_time TIME NOT NULL, -- e.g., 09:00
  end_time TIME NOT NULL,   -- e.g., 17:00
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table to store blocked dates (holidays, days off)
CREATE TABLE consultant_blocked_dates (
  id BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table to store time slot preferences (for specific dates with custom hours)
CREATE TABLE consultant_schedule_exceptions (
  id BIGSERIAL PRIMARY KEY,
  consultant_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  start_time TIME,       -- NULL means blocked all day
  end_time TIME,         -- NULL means blocked all day
  is_available BOOLEAN NOT NULL DEFAULT FALSE, -- FALSE = blocked, TRUE = available (override)
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Extended consulting_sessions_scheduled to include confirmed time slot
ALTER TABLE consulting_sessions_scheduled
ADD COLUMN IF NOT EXISTS scheduled_date DATE,
ADD COLUMN IF NOT EXISTS scheduled_time TIME,
ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 120,
ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(512),
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

-- Create indexes for efficient queries
CREATE INDEX idx_consultant_availability_consultant_id
ON consultant_availability(consultant_id, day_of_week, is_active);

CREATE INDEX idx_consultant_blocked_dates_consultant_id
ON consultant_blocked_dates(consultant_id, blocked_date);

CREATE INDEX idx_consultant_schedule_exceptions_consultant_id
ON consultant_schedule_exceptions(consultant_id, exception_date);

CREATE INDEX idx_consulting_sessions_scheduled_date
ON consulting_sessions_scheduled(consultant_assigned_id, scheduled_date);

-- Create function to get consultant available slots for a given date
CREATE OR REPLACE FUNCTION get_consultant_available_slots(
  p_consultant_id BIGINT,
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
  v_is_blocked BOOLEAN;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_target_date)::INT;

  -- Check for schedule exception first (takes priority)
  SELECT is_available INTO v_is_blocked
  FROM consultant_schedule_exceptions
  WHERE consultant_id = p_consultant_id
    AND exception_date = p_target_date
  LIMIT 1;

  IF FOUND THEN
    -- Has exception for this date
    SELECT start_time, end_time INTO v_start_time, v_end_time
    FROM consultant_schedule_exceptions
    WHERE consultant_id = p_consultant_id
      AND exception_date = p_target_date;

    IF v_start_time IS NULL THEN
      -- Fully blocked
      RETURN;
    ELSE
      -- Custom hours - use them
      -- Return generated slots
      WITH slot_times AS (
        SELECT generate_series(v_start_time, v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
                              (p_slot_duration_minutes || ' minutes')::INTERVAL) AS slot_start
      )
      SELECT slot_start,
             (slot_start + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
             TRUE::BOOLEAN
      FROM slot_times;
      RETURN;
    END IF;
  END IF;

  -- Check if date is blocked
  IF EXISTS (
    SELECT 1 FROM consultant_blocked_dates
    WHERE consultant_id = p_consultant_id AND blocked_date = p_target_date
  ) THEN
    RETURN;
  END IF;

  -- Use recurring availability for this day of week
  SELECT start_time, end_time INTO v_start_time, v_end_time
  FROM consultant_availability
  WHERE consultant_id = p_consultant_id
    AND day_of_week = v_day_of_week
    AND is_active = TRUE
  LIMIT 1;

  IF v_start_time IS NOT NULL THEN
    -- Generate slots for this day
    WITH slot_times AS (
      SELECT generate_series(v_start_time, v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
                            (p_slot_duration_minutes || ' minutes')::INTERVAL) AS slot_start
    )
    SELECT slot_start,
           (slot_start + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
           TRUE::BOOLEAN
    FROM slot_times;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to check if a specific time slot is available (not booked)
CREATE OR REPLACE FUNCTION is_time_slot_available(
  p_consultant_id BIGINT,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check for conflicting bookings
  RETURN NOT EXISTS (
    SELECT 1 FROM consulting_sessions_scheduled
    WHERE consultant_assigned_id = p_consultant_id
      AND scheduled_date = p_date
      AND scheduled_time < p_end_time
      AND (scheduled_time + (duration_minutes || ' minutes')::INTERVAL)::TIME > p_start_time
      AND status IN ('scheduled', 'completed')
  );
END;
$$ LANGUAGE plpgsql;
