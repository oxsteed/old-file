-- G10-1 (Nov 21 audit): consultant payout leg. The consultant's share of a
-- business-launch engagement is computed and stored on consulting_requests
-- but was never paid. One payout row per engagement, created when the
-- request transitions to 'completed'; the OxSteed Credit load posts under
-- the row's idempotency key so a completion can never pay twice.
--
-- Statuses: pending (created, not yet attempted), paid (Credit load posted),
-- parked (rail off / frozen / legal clearance missing; retryable, visible),
-- failed (any other attempt error; retryable, visible).
--
-- created_by stores the completing admin's UUID so sweeper retries post
-- the Credit load with a real admin actor (migration 487's trigger rejects
-- actor_type 'system' for load transactions).
CREATE TABLE IF NOT EXISTS consulting_consultant_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulting_request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE RESTRICT,
  consultant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'parked', 'failed')),
  reason_code VARCHAR(100),
  reason_detail TEXT,
  credit_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS consulting_consultant_payouts_request_uidx
  ON consulting_consultant_payouts (consulting_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS consulting_consultant_payouts_idempotency_uidx
  ON consulting_consultant_payouts (idempotency_key);
CREATE INDEX IF NOT EXISTS consulting_consultant_payouts_consultant_idx
  ON consulting_consultant_payouts (consultant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS consulting_consultant_payouts_status_idx
  ON consulting_consultant_payouts (status, last_attempted_at);
