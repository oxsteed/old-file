-- Migration 596: durable marketplace refund reconciliation
--
-- Marketplace refunds may be requested by more than one authorized surface.
-- Keep the marketplace transaction authoritative for the payment total while
-- recording each provider operation so retries and partial refunds cannot be
-- mistaken for a new charge or a full refund.

ALTER TABLE marketplace_transactions
  ADD COLUMN IF NOT EXISTS refunded_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_refund_at TIMESTAMP;

ALTER TABLE marketplace_transactions
  DROP CONSTRAINT IF EXISTS marketplace_transactions_refunded_amount_check;

ALTER TABLE marketplace_transactions
  ADD CONSTRAINT marketplace_transactions_refunded_amount_check
  CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents);

CREATE TABLE IF NOT EXISTS marketplace_transaction_refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL REFERENCES marketplace_transactions(id) ON DELETE CASCADE,
  payment_intent_id VARCHAR(255) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(255) UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  provider_payload JSONB,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_attempts >= 0),
  last_attempt_at TIMESTAMP,
  last_error TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketplace_refunds_order_created
  ON marketplace_transaction_refunds(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_refunds_transaction_status
  ON marketplace_transaction_refunds(transaction_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_refunds_provider_id
  ON marketplace_transaction_refunds(provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
