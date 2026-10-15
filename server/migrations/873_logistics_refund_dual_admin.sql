-- Migration 873: OxSteed Logistics — dual-admin refund flow (Phase 3)
--
-- Implements the spec's "Refunds and exceptions" dual-admin model:
-- one admin proposes, a DIFFERENT admin approves with fresh authentication,
-- execution only after processor confirmation or a committed Credit reversal.
--
-- This migration EXTENDS logistics_refund_cases (created in 247) and adds:
--   - logistics_refund_decisions     (audit of every propose/approve/reject/execute/expire)
--   - logistics_fresh_auth_events    (TOTP step-up events; approvals must be fresh)
--   - logistics_reconciliation_queue (shared queue; the parallel Stripe workstream
--                                      finalizes failed/executing refunds here)
--
-- Notes:
--   - proposed_by stays NULL-able for legacy rows; the refund service enforces
--     it NOT NULL for all new cases (application-level constraint).
--   - original_payment_attempt_id has NO foreign key: the logistics_payment_attempts
--     table is owned by the parallel Stripe/checkout workstream and does not exist
--     yet. The refund service probes for it and FAILS CLOSED when it is absent.
--     The FK should be added once the table lands.

-- ─── 1. Extend logistics_refund_cases ─────────────────────────

ALTER TABLE logistics_refund_cases
  ADD COLUMN IF NOT EXISTS proposed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS original_payment_attempt_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS fresh_auth_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processor_ref VARCHAR(100);

-- Legacy statuses (pending|reviewing|approved|processed|rejected) keep working;
-- the dual-admin flow uses proposed|approved|executing|processed|failed|rejected|expired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_cases_status'
  ) THEN
    ALTER TABLE logistics_refund_cases
      ADD CONSTRAINT chk_refund_cases_status
      CHECK (status IN ('pending','reviewing','approved','processed','rejected',
                        'proposed','executing','failed','expired'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_cases_method'
  ) THEN
    ALTER TABLE logistics_refund_cases
      ADD CONSTRAINT chk_refund_cases_method
      CHECK (refund_method IS NULL OR refund_method IN ('stripe','credit'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_refund_cases_amount_cents'
  ) THEN
    ALTER TABLE logistics_refund_cases
      ADD CONSTRAINT chk_refund_cases_amount_cents
      CHECK (amount_cents IS NULL OR amount_cents > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refund_cases_proposed_by ON logistics_refund_cases(proposed_by);
CREATE INDEX IF NOT EXISTS idx_refund_cases_payment_attempt ON logistics_refund_cases(original_payment_attempt_id);

-- ─── 2. Refund decision audit log ────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_refund_decisions (
  id BIGSERIAL PRIMARY KEY,
  refund_case_id INTEGER NOT NULL REFERENCES logistics_refund_cases(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(30) NOT NULL, -- propose|approve|reject|execute|execute_pending|execute_failed|expire
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  fresh_auth_ref VARCHAR(128), -- hash of the fresh-auth event (approvals only)
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_refund_decisions_case ON logistics_refund_decisions(refund_case_id);
CREATE INDEX IF NOT EXISTS idx_refund_decisions_actor ON logistics_refund_decisions(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_refund_decisions_ts ON logistics_refund_decisions(decided_at DESC);

-- ─── 3. Fresh-auth (step-up) events ──────────────────────────

CREATE TABLE IF NOT EXISTS logistics_fresh_auth_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  method VARCHAR(20) NOT NULL DEFAULT 'totp',
  purpose VARCHAR(80) NOT NULL DEFAULT 'logistics_refund_approve',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash VARCHAR(128),
  auth_hash VARCHAR(128) UNIQUE NOT NULL -- reference recorded on the approve decision
);

CREATE INDEX IF NOT EXISTS idx_fresh_auth_user_ts ON logistics_fresh_auth_events(user_id, completed_at DESC);

-- ─── 4. Shared reconciliation queue ──────────────────────────
-- Owned jointly with the Stripe workstream: failed refunds land here for
-- human reconciliation; executing-but-unconfirmed Stripe refunds are picked
-- up from here by the webhook worker. Do NOT create a second queue.

CREATE TABLE IF NOT EXISTS logistics_reconciliation_queue (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(40) NOT NULL,        -- e.g. 'logistics_refund'
  entity_id INTEGER NOT NULL,         -- logistics_refund_cases.id
  reason VARCHAR(200) NOT NULL,
  payload JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|claimed|resolved
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_queue_status ON logistics_reconciliation_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_recon_queue_source_entity ON logistics_reconciliation_queue(source, entity_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_recon_queue_status'
  ) THEN
    ALTER TABLE logistics_reconciliation_queue
      ADD CONSTRAINT chk_recon_queue_status
      CHECK (status IN ('pending','claimed','resolved'));
  END IF;
END $$;
