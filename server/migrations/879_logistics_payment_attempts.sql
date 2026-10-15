-- 879_logistics_payment_attempts.sql
-- Phase 3 (logistics refactor): durable buyer payment attempts.
--
-- A payment attempt is the single durable record of "the buyer tried to pay
-- installment X of subject Y". Client-supplied amounts are NEVER trusted:
-- the amount is computed server-side from the accepted quote, and the
-- client-supplied idempotency key (UNIQUE) makes concurrent duplicate
-- submissions converge on one row. Only a signed Stripe webhook may move
-- an attempt to 'succeeded'; browser redirects or client-reported success
-- can never settle a payment.
--
-- Amounts are INTEGER minor units (cents); USD only. New integer paid
-- columns are added to the legacy float-USD tables so the new flow never
-- does float math on money; the legacy float columns are kept in sync for
-- the existing read endpoints and backfilled from their previous values.

CREATE TABLE IF NOT EXISTS logistics_payment_attempts (
  id                        SERIAL PRIMARY KEY,
  idempotency_key           TEXT NOT NULL UNIQUE,
  buyer_user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_type              TEXT NOT NULL
                            CHECK (subject_type IN ('purchase_order', 'pooled_participant')),
  purchase_order_id         INTEGER REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  participant_id            INTEGER REFERENCES pooled_order_participants(id) ON DELETE RESTRICT,
  quote_id                  INTEGER REFERENCES logistics_buyer_quotes(id) ON DELETE RESTRICT,
  installment               TEXT NOT NULL CHECK (installment IN ('deposit', 'final')),
  amount_cents              INTEGER NOT NULL CHECK (amount_cents > 0),
  currency                  CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  method                    TEXT NOT NULL CHECK (method IN ('stripe', 'credit')),
  status                    TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'succeeded',
                                              'failed', 'canceled')),
  stripe_payment_intent_id  TEXT UNIQUE,
  failure_code              TEXT,
  failure_message           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at                TIMESTAMPTZ,
  CONSTRAINT logistics_attempt_single_subject CHECK (
    (purchase_order_id IS NOT NULL AND participant_id IS NULL)
    OR (purchase_order_id IS NULL AND participant_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_logistics_attempts_buyer
  ON logistics_payment_attempts(buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logistics_attempts_po
  ON logistics_payment_attempts(purchase_order_id, installment, status);
CREATE INDEX IF NOT EXISTS idx_logistics_attempts_participant
  ON logistics_payment_attempts(participant_id, installment, status);
CREATE INDEX IF NOT EXISTS idx_logistics_attempts_status
  ON logistics_payment_attempts(status, updated_at);

-- ─── Integer paid columns on the legacy tables ────────────────
-- The legacy *_usd float columns remain the read source for existing
-- endpoints; the new *_cents columns are the money-safe source of truth
-- for the payments flow and are kept in sync with the floats.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS deposit_paid_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_paid_cents   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pooled_order_participants
  ADD COLUMN IF NOT EXISTS deposit_paid_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_paid_cents   INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_paid_cents_nonneg') THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_paid_cents_nonneg
      CHECK (deposit_paid_cents >= 0 AND final_paid_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pooled_participants_paid_cents_nonneg') THEN
    ALTER TABLE pooled_order_participants
      ADD CONSTRAINT pooled_participants_paid_cents_nonneg
      CHECK (deposit_paid_cents >= 0 AND final_paid_cents >= 0);
  END IF;
END $$;

-- Backfill from the legacy float columns so existing paid state carries
-- over exactly once, rounded to the cent. A participant's legacy record
-- only tracks whether the deposit was paid (deposit_paid_at), not how
-- much, so the due amount stands in for the paid amount there.
UPDATE purchase_orders
   SET deposit_paid_cents = (ROUND(COALESCE(deposit_paid_usd, 0) * 100))::INTEGER
 WHERE deposit_paid_cents = 0 AND COALESCE(deposit_paid_usd, 0) <> 0;

UPDATE purchase_orders
   SET final_paid_cents = (ROUND(COALESCE(final_paid_usd, 0) * 100))::INTEGER
 WHERE final_paid_cents = 0 AND COALESCE(final_paid_usd, 0) <> 0;

UPDATE pooled_order_participants
   SET deposit_paid_cents = (ROUND(COALESCE(deposit_amount_usd, 0) * 100))::INTEGER
 WHERE deposit_paid_at IS NOT NULL AND deposit_paid_cents = 0;

UPDATE pooled_order_participants
   SET final_paid_cents = (ROUND(COALESCE(final_payment_usd, 0) * 100))::INTEGER
 WHERE final_paid_at IS NOT NULL AND final_paid_cents = 0;
