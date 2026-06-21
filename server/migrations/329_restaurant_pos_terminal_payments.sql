-- Migration 329: Processor-backed Stripe Terminal POS payments.

ALTER TABLE restaurant_pos_payments
  ADD COLUMN IF NOT EXISTS provider VARCHAR(40),
  ADD COLUMN IF NOT EXISTS provider_payment_intent_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_charge_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_refund_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_pos_payments_idempotency
  ON restaurant_pos_payments (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_pos_payments_provider_intent
  ON restaurant_pos_payments (provider, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL AND payment_type <> 'refund';
