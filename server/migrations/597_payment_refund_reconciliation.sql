-- Migration 597: durable reconciliation for Tier-3 payment refunds.
-- Keep each provider refund attempt separate from the payment's cumulative
-- refunded amount so partial refunds and retries remain auditable.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) NOT NULL DEFAULT 0;

UPDATE payments
   SET refunded_amount = refund_amount
 WHERE refunded_amount = 0
   AND refund_amount IS NOT NULL
   AND refund_amount > 0;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_refunded_amount_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_refunded_amount_check
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

CREATE TABLE IF NOT EXISTS payment_refund_attempts (
  id BIGSERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason TEXT,
  reverse_application_fee BOOLEAN NOT NULL DEFAULT false,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  stripe_refund_id VARCHAR(255) UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  provider_payload JSONB,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_attempts >= 0),
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_attempts_payment_created
  ON payment_refund_attempts(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_refund_attempts_pending
  ON payment_refund_attempts(status, updated_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refund_attempts_stripe_id
  ON payment_refund_attempts(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
