-- Migration 761: customer re-authorization after a change order raises the
-- price above what is authorized.
--
-- One row per attempt. A card attempt is a replacement manual-capture
-- PaymentIntent on the helper's connected account (Stripe incremental
-- authorization is not available for every card, so the replacement is the
-- portable path); 'reprice' updates a not-yet-confirmed intent in place; a
-- 'credit_hold' attempt re-places OxSteed Credit escrow collateral that could
-- not be placed when the change order was approved.
--
-- While jobs.metadata.paymentAdjustmentRequired is set, completion and
-- capture are refused. A successful attempt swaps the payment row onto the
-- new intent, cancels the old one, and clears the flag.

CREATE TABLE IF NOT EXISTS job_payment_reauthorizations (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  change_order_id UUID, -- informational; change orders may be archived
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('card', 'credit')),
  kind TEXT NOT NULL CHECK (kind IN ('replacement', 'reprice', 'credit_hold')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'failed', 'canceled', 'expired')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  previous_authorized_cents INTEGER,
  stripe_payment_intent_id TEXT,
  stripe_account_id TEXT,
  previous_payment_intent_id TEXT,
  previous_intent_canceled_at TIMESTAMPTZ,
  credit_hold_id UUID,
  failure_code TEXT,
  failure_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, attempt)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_payment_reauth_intent_uidx
  ON job_payment_reauthorizations (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- At most one open attempt per job; retries reuse it.
CREATE UNIQUE INDEX IF NOT EXISTS job_payment_reauth_open_uidx
  ON job_payment_reauthorizations (job_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS job_payment_reauth_expiry_idx
  ON job_payment_reauthorizations (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS job_payment_reauth_previous_intent_idx
  ON job_payment_reauthorizations (previous_payment_intent_id)
  WHERE previous_payment_intent_id IS NOT NULL;
