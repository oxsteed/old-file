-- Group 12 Slice 3i (641-645, D-341/D-342/D-343/D-344/D-345/D-346): transition.
-- One operator handoff flow, in roadmap order: the outgoing operator
-- initiates a handoff (641), HQ approves or rejects it; only on approval do
-- open issues transfer to the incoming operator (642), the territory's
-- records change hands by access/visibility, never by moving files (644),
-- and the outgoing operator's access is revoked through that approved flow
-- (645). The operator-maintained contact directory (643) is a separate
-- per-territory table; the explicit HQ removal of a territory member's
-- access (645) is audited in franchise_access_removals.
-- Additive only; safe to run twice (IF NOT EXISTS / partial unique index).
-- No money moves here: franchise money is record-only (D-291).

-- 641: the handoff record. Status is pending until HQ decides; approval
-- executes the transfer atomically (642/644/645) and stamps the checklist
-- and records snapshots taken at that moment, so the record is the audit
-- trail. One live (pending) handoff per territory; the outgoing and
-- incoming operators must differ (CHECK). A handoff never grants the
-- incoming operator anything while pending — access changes only in the
-- approval transaction, via syncFranchiseGrant.
CREATE TABLE IF NOT EXISTS franchise_handoffs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  outgoing_operator_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incoming_operator_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason               TEXT,
  checklist_snapshot   JSONB,
  records_snapshot     JSONB,
  decided_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  decision_reason      TEXT,
  completed_at         TIMESTAMPTZ,
  created_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (outgoing_operator_id <> incoming_operator_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_handoffs_pending
  ON franchise_handoffs(application_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_franchise_handoffs_application
  ON franchise_handoffs(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_handoffs_incoming
  ON franchise_handoffs(incoming_operator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_handoffs_outgoing
  ON franchise_handoffs(outgoing_operator_id, status, created_at DESC);

-- 642: the HQ-visible transfer log. One row per open issue that changed
-- hands on approval: remediations are reassigned (due date preserved),
-- corrective actions move with their remediation (ownership is derived
-- from it), escalations move as a responsibility note — the ticket itself
-- is never reassigned (its requester owns it). No row is ever written
-- outside the approval transaction: there is no silent reassignment.
CREATE TABLE IF NOT EXISTS franchise_handoff_transfers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id     UUID        NOT NULL REFERENCES franchise_handoffs(id) ON DELETE CASCADE,
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  kind           VARCHAR(30) NOT NULL
                   CHECK (kind IN ('remediation', 'corrective_action', 'escalation')),
  ticket_id      UUID        REFERENCES support_tickets(id) ON DELETE SET NULL,
  remediation_id UUID        REFERENCES franchise_remediations(id) ON DELETE SET NULL,
  action_id      UUID        REFERENCES franchise_corrective_actions(id) ON DELETE SET NULL,
  from_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  to_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  due_date       DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_handoff_transfers_handoff
  ON franchise_handoff_transfers(handoff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_handoff_transfers_application
  ON franchise_handoff_transfers(application_id, created_at DESC);

-- 643: the operator-maintained contact directory, scoped to the territory.
-- A row is either linked to a territory member (contact_user_id; name and
-- email then read from the user row, never stored) or a manual entry
-- (name + email required). One directory row per member per territory.
-- HQ reads the same directory; HQ never writes it.
CREATE TABLE IF NOT EXISTS franchise_contact_directory (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  contact_user_id UUID        REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT,
  email           TEXT,
  phone           VARCHAR(50),
  role            VARCHAR(100),
  notes           TEXT,
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (contact_user_id IS NOT NULL OR (name IS NOT NULL AND email IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_contact_directory_user
  ON franchise_contact_directory(application_id, contact_user_id)
  WHERE contact_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_franchise_contact_directory_application
  ON franchise_contact_directory(application_id, created_at DESC);

-- 645: the audit trail for explicit HQ removals of a territory member's
-- access. Removing the operator never lands here: the operator's access
-- ends only through a completed handoff (or an HQ owner change), so this
-- table records invitee/helper removals only.
CREATE TABLE IF NOT EXISTS franchise_access_removals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  membership_kind VARCHAR(20) NOT NULL CHECK (membership_kind IN ('invitee', 'helper')),
  reason          TEXT        NOT NULL,
  removed_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_access_removals_application
  ON franchise_access_removals(application_id, created_at DESC);
