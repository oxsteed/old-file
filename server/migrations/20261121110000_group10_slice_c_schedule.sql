-- Group 10 Slice C (items 516-520): schedule sessions.
-- Reschedule proposals and attendance confirmations for confirmed
-- consulting appointments, plus cancellation bookkeeping on the scheduled
-- row. All additions; nothing modified.
--
-- 516 Appointment options: verified EXISTS (duration 60/90/120 + meeting
-- formats round-trip through book-slot); no schema change.
-- 517 Time zone selection: no schema change (canonical zone is the
-- consultant profile timezone; conversion is computed at read time).
-- 518 Reschedule proposal: consulting_session_reschedules.
-- 519 Cancellation handling: cancellation columns on the scheduled row.
-- 520 Attendance confirmation: consulting_session_attendance.

CREATE TABLE IF NOT EXISTS consulting_session_reschedules (
  id BIGSERIAL PRIMARY KEY,
  scheduled_session_id BIGINT NOT NULL REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_by_role VARCHAR(20) NOT NULL CHECK (proposed_by_role IN ('client', 'consultant', 'admin')),
  proposed_date DATE NOT NULL,
  proposed_time TIME NOT NULL,
  proposed_duration_minutes INT NOT NULL DEFAULT 120 CHECK (proposed_duration_minutes BETWEEN 1 AND 480),
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'declined', 'withdrawn')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consulting_reschedules_session
  ON consulting_session_reschedules(scheduled_session_id);

-- At most one open proposal per scheduled session: a second proposal
-- while one is open is a 409, so the counterparty never faces two
-- competing moves on the same appointment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_reschedules_one_open
  ON consulting_session_reschedules(scheduled_session_id)
  WHERE status = 'proposed';

CREATE TABLE IF NOT EXISTS consulting_session_attendance (
  id BIGSERIAL PRIMARY KEY,
  scheduled_session_id BIGINT NOT NULL REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'consultant')),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consulting_session_attendance_one_per_role UNIQUE (scheduled_session_id, role)
);

CREATE INDEX IF NOT EXISTS idx_consulting_attendance_session
  ON consulting_session_attendance(scheduled_session_id);

ALTER TABLE consulting_sessions_scheduled
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
