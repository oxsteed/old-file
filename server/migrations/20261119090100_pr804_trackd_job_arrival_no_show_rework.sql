-- PR #804 ecosystem gaps G-15 (arrival / no-show) and G-16 (rework path).
-- Arrival mirrors the delivery scan pattern (migration 576): it is a
-- recorded event (arrived_at timestamp + notification), not a new status
-- machine. The job/appointment status is untouched by arrival.
-- no_show IS a terminal status: jobs.status is free VARCHAR, appointments
-- gains it in its status CHECK below. A no-show keeps the record so the
-- client can offer a rebook prompt from it.
-- Rework (G-16) reuses the existing in_progress state; the change request
-- itself is recorded here and the auto-confirm clock is paused by clearing
-- completion_requested_at (see jobController.requestJobChanges).

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_show_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS change_request_reason TEXT,
  ADD COLUMN IF NOT EXISTS change_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS change_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_show_reason VARCHAR(500);

-- Widen the appointments status CHECK (migration 112) to admit no_show.
-- The inline CHECK was auto-named appointments_status_check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'appointments' AND constraint_name = 'appointments_status_check'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
  END IF;
END $$;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('requested','confirmed','in_progress','completed','cancelled','rescheduled','no_show'));
