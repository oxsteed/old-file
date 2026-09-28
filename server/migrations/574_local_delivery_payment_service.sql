-- Requires 566/570/571. Does not adopt or rewrite legacy Stripe sessions.
BEGIN;

ALTER TABLE delivery_payments
  ADD COLUMN IF NOT EXISTS service_version INTEGER,
  ADD COLUMN IF NOT EXISTS charge_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents);

-- One financial obligation, independent of HTTP idempotency keys. Legacy rows
-- remain available for investigation; the service blocks new checkout on them.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_payment_base_obligation
  ON delivery_payments(delivery_job_id)
  WHERE service_version = 1 AND delivery_extra_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_payment_extra_obligation
  ON delivery_payments(delivery_extra_id)
  WHERE service_version = 1 AND delivery_extra_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_payment_intent_identity
  ON delivery_payments(payment_intent_id)
  WHERE service_version = 1 AND payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES delivery_payments(id),
  generation INTEGER NOT NULL CHECK (generation > 0),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  request_snapshot JSONB NOT NULL,
  checkout_session_id VARCHAR(255) UNIQUE,
  payment_intent_id VARCHAR(255) UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'open', 'complete', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, generation)
);

CREATE TABLE IF NOT EXISTS delivery_payment_refunds (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES delivery_payments(id),
  target_refunded_cents INTEGER NOT NULL CHECK (target_refunded_cents > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(255) UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, target_refunded_cents)
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_payment_one_pending_refund
  ON delivery_payment_refunds(payment_id) WHERE status = 'pending';

-- Use the existing immutable platform ledger, with a delivery-specific key.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_payment_ledger_identity
  ON platform_ledger ((metadata->>'deliveryLedgerKey'))
  WHERE metadata->>'deliveryLedgerKey' IS NOT NULL;

COMMIT;
