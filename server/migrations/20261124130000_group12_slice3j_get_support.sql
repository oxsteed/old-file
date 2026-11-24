-- Group 12 Slice 3j (646-650, D-347/D-348/D-349/D-350/D-351): get support.
-- 646 policy questions and 649 case tracking / 650 support history reuse
-- the support ticket machinery (D-293/D-327): a policy question IS a
-- ticket with category 'policy_question', and the case tracker and the
-- history are derived views over existing records — no new tables for
-- them. This migration adds only the two records that have no home yet:
-- 647 dedicated HQ operations-appointment slots (NOT the consulting
-- flow, D-300) and 648 training escalations (one live escalation per
-- training item, the 631 pattern).
-- Additive only; safe to run twice (IF NOT EXISTS / IF NOT EXISTS index).
-- No money moves here: franchise money is record-only (D-291).

-- 647: HQ publishes dedicated operations slots per territory; the
-- operator books one, HQ confirms/cancels, HQ marks it completed.
-- A slot is proposed (available), booked, confirmed, completed, or
-- cancelled (terminal). Booking, confirmation, and cancellation
-- timestamps are kept so the support history (650) can derive its
-- appointment events from this row alone.
CREATE TABLE IF NOT EXISTS franchise_ops_appointment_slots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  title          VARCHAR(255),
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ,
  note           TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'booked', 'confirmed', 'completed', 'cancelled')),
  created_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  booked_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  booked_at      TIMESTAMPTZ,
  confirmed_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at   TIMESTAMPTZ,
  completed_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  completed_at   TIMESTAMPTZ,
  cancelled_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at   TIMESTAMPTZ,
  cancel_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_ops_slots_application
  ON franchise_ops_appointment_slots(application_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_franchise_ops_slots_booked
  ON franchise_ops_appointment_slots(booked_by, status);

-- 648: a training escalation — a training issue/gap raised to HQ, tied
-- to a training assignment when there is one, otherwise to a member +
-- module (+ location). One live escalation (open/in_progress) per
-- assignment, or per member + module + location when unassigned;
-- resolved escalations need a resolution note (enforced server-side).
CREATE TABLE IF NOT EXISTS franchise_training_escalations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  assignment_id    UUID        REFERENCES franchise_training_assignments(id) ON DELETE SET NULL,
  member_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  module_title     VARCHAR(255),
  location_id      UUID        REFERENCES franchise_locations(id) ON DELETE SET NULL,
  reason           TEXT        NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'resolved')),
  escalated_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolved_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  resolution       TEXT,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_training_escalations_application
  ON franchise_training_escalations(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_training_escalations_assignment
  ON franchise_training_escalations(assignment_id, status);
