-- Group 1 (Customer, item 14): booking-level reschedule proposals.
--
-- An accepted booking's time window changes ONLY when the other party
-- accepts a proposal. The proposal itself is a row, not a mutation:
-- booking_requests.requested_date / requested_start_time /
-- requested_end_time and the linked appointment are untouched while a
-- proposal is pending, and a declined proposal leaves the booking exactly
-- as it was. Deposits, pricing and cancellation rules are untouched by a
-- pending proposal (no money moves here at all).
--
-- This is the booking-level counterpart of the appointment-level
-- reschedule flow (migration 169, appointment_reschedule_requests),
-- which only covers appointments. A pending booking already has the
-- provider counter-propose path, which mutates the requested window on
-- propose; this table covers the accepted booking, where both parties
-- need a propose/accept/decline round-trip.
CREATE TABLE IF NOT EXISTS booking_reschedule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_by_role VARCHAR(20) NOT NULL,
  proposed_date DATE NOT NULL,
  proposed_start_time TIME NOT NULL,
  proposed_end_time TIME NOT NULL,
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_reschedule_proposals_role_check'
      AND conrelid = 'booking_reschedule_proposals'::regclass
  ) THEN
    ALTER TABLE booking_reschedule_proposals
      ADD CONSTRAINT booking_reschedule_proposals_role_check
      CHECK (proposed_by_role IN ('customer', 'helper', 'business'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_reschedule_proposals_status_check'
      AND conrelid = 'booking_reschedule_proposals'::regclass
  ) THEN
    ALTER TABLE booking_reschedule_proposals
      ADD CONSTRAINT booking_reschedule_proposals_status_check
      CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'superseded'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_reschedule_proposals_times_check'
      AND conrelid = 'booking_reschedule_proposals'::regclass
  ) THEN
    ALTER TABLE booking_reschedule_proposals
      ADD CONSTRAINT booking_reschedule_proposals_times_check
      CHECK (proposed_end_time > proposed_start_time);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_reschedule_proposals_booking
  ON booking_reschedule_proposals (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_proposals_pending
  ON booking_reschedule_proposals (booking_id)
  WHERE status = 'pending';
