-- Migration 865: dual-approval (maker-checker) queue for money movements.
--
-- ADM-016: money could move on every rail (job refunds, marketplace
-- refunds, dispute refunds, restaurant payouts, affiliate payouts) with a
-- single admin approval. This table records above-threshold money movements
-- as pending until a DIFFERENT admin approves them.
--
-- Money-safety contract (fail closed):
--  - A movement is recorded 'pending' and NOTHING moves until a second
--    admin approves. The executor runs inside the same transaction that
--    flips the row to 'executed', so a crash cannot approve without
--    executing or execute without approving.
--  - Self-approval is forbidden (decided_by must differ from requested_by);
--    the service enforces this, not just the client.
--  - Idempotency: idempotency_key is UNIQUE. Replaying a key returns the
--    existing row (pending -> 202, executed -> replay of the result,
--    terminal rejected/failed -> 409) instead of queuing a duplicate.
--  - Rejection is terminal. A rejected movement needs a brand-new request.

CREATE TABLE IF NOT EXISTS money_movement_approvals (
  id BIGSERIAL PRIMARY KEY,
  -- Rail that owns the movement: 'job_refund' | 'marketplace_refund' |
  -- 'dispute_refund' | 'restaurant_payout' | 'affiliate_payout'.
  movement_type TEXT NOT NULL,
  -- Business reference, e.g. 'job:123', 'order:456', 'dispute:7'.
  reference_key TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Client-supplied idempotency key, namespaced per rail by the service.
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Rail-specific execution parameters (JSONB, validated by the executor).
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  executed_at TIMESTAMPTZ,
  -- Executor result snapshot (refund ids, payout ids) for replay responses.
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT money_movement_no_self_approval
    CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE INDEX IF NOT EXISTS idx_money_movement_approvals_status
  ON money_movement_approvals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_money_movement_approvals_requested_by
  ON money_movement_approvals (requested_by);
CREATE INDEX IF NOT EXISTS idx_money_movement_approvals_reference
  ON money_movement_approvals (movement_type, reference_key);
