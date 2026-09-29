-- Migration 598: durable reconciliation for payment rails that are not backed
-- by the marketplace payments table (food support and consulting).
-- This is an attempt record, not a second financial ledger. The owning domain
-- remains responsible for its own payment/status transition after settlement.

CREATE TABLE IF NOT EXISTS external_refund_attempts (
  id BIGSERIAL PRIMARY KEY,
  rail VARCHAR(64) NOT NULL,
  reference_id VARCHAR(255) NOT NULL,
  provider_payment_intent_id VARCHAR(255) NOT NULL,
  provider_account_id VARCHAR(255),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  reason TEXT,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(255) UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  provider_payload JSONB,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_attempts >= 0),
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_external_refund_attempts_reference
  ON external_refund_attempts(rail, reference_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_refund_attempts_pending
  ON external_refund_attempts(status, updated_at)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_refund_attempts_provider_id
  ON external_refund_attempts(provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
