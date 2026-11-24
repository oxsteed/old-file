-- Group 12 Slice 3g (631-635, D-331/D-332/D-333/D-334/D-335): resolve exceptions.
-- Franchise exceptions stay support tickets (D-293/D-327); this slice adds
-- the resolution workflow ON those tickets, not a parallel exception system:
-- 631 escalations recorded on the ticket (priority bump + note),
-- 632 one remediation owner + due date per linked exception,
-- 633 a corrective-action checklist per exception (open -> in_progress ->
-- resolved -> verified), 634 evidence attached to a corrective action,
-- 635 HQ resolution review that verifies or sends an action back.
-- Additive only; safe to run twice (IF NOT EXISTS / IF NOT EXISTS index).
-- No money moves here: franchise money is record-only (D-291).

CREATE TABLE IF NOT EXISTS franchise_ticket_escalations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  ticket_id        UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  escalated_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  reason           TEXT        NOT NULL,
  priority_before  VARCHAR(20) NOT NULL,
  priority_after   VARCHAR(20) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_escalations_application
  ON franchise_ticket_escalations(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_escalations_ticket
  ON franchise_ticket_escalations(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS franchise_remediations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  ticket_id      UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  owner_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date       DATE        NOT NULL,
  assigned_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_remediations_owner
  ON franchise_remediations(owner_user_id, due_date);

CREATE TABLE IF NOT EXISTS franchise_corrective_actions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  ticket_id      UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  remediation_id UUID        REFERENCES franchise_remediations(id) ON DELETE SET NULL,
  title          TEXT        NOT NULL,
  description    TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'resolved', 'verified')),
  review_reason  TEXT,
  reviewed_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  created_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_corrective_actions_ticket
  ON franchise_corrective_actions(application_id, ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_corrective_actions_status
  ON franchise_corrective_actions(application_id, status);

CREATE TABLE IF NOT EXISTS franchise_action_evidence (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID        NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  ticket_id       UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  action_id       UUID        NOT NULL REFERENCES franchise_corrective_actions(id) ON DELETE CASCADE,
  storage_key     TEXT        NOT NULL,
  file_name       VARCHAR(255),
  content_type    VARCHAR(100),
  file_size_bytes INTEGER,
  note            TEXT,
  uploaded_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_action_evidence_action
  ON franchise_action_evidence(action_id, created_at DESC);
