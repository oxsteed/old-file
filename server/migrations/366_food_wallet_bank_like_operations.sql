-- Migration 366: Bank-like operations for restaurant-scoped customer credit.
-- Credit remains isolated by restaurant. Holds reserve spendable value without
-- changing the posted ledger balance; captures, releases, and transfers are
-- permanent records tied back to the immutable wallet ledger.

ALTER TABLE food_customer_wallet_accounts
  ADD COLUMN IF NOT EXISTS reserved_cents BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_food_wallet_reserved_nonnegative'
       AND conrelid = 'food_customer_wallet_accounts'::regclass
  ) THEN
    ALTER TABLE food_customer_wallet_accounts
      ADD CONSTRAINT chk_food_wallet_reserved_nonnegative
      CHECK (reserved_cents >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS food_customer_wallet_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'captured', 'released', 'expired')),
  purpose VARCHAR(80),
  reference_type VARCHAR(60),
  reference_id VARCHAR(120),
  idempotency_key VARCHAR(120),
  correlation_id VARCHAR(120),
  captured_ledger_entry_id BIGINT REFERENCES food_customer_wallet_ledger(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_food_wallet_hold_idempotency
  ON food_customer_wallet_holds(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_wallet_holds_account_status
  ON food_customer_wallet_holds(account_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_food_wallet_holds_restaurant_created
  ON food_customer_wallet_holds(restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS food_customer_wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  sender_customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_account_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE RESTRICT,
  recipient_account_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'reversed')),
  memo VARCHAR(255),
  idempotency_key VARCHAR(120) NOT NULL,
  correlation_id VARCHAR(120),
  debit_ledger_entry_id BIGINT REFERENCES food_customer_wallet_ledger(id) ON DELETE RESTRICT,
  credit_ledger_entry_id BIGINT REFERENCES food_customer_wallet_ledger(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  UNIQUE (restaurant_id, sender_customer_id, idempotency_key),
  CHECK (sender_customer_id <> recipient_customer_id),
  CHECK (sender_account_id <> recipient_account_id)
);

CREATE INDEX IF NOT EXISTS idx_food_wallet_transfers_sender
  ON food_customer_wallet_transfers(sender_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_wallet_transfers_recipient
  ON food_customer_wallet_transfers(recipient_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_wallet_transfers_restaurant
  ON food_customer_wallet_transfers(restaurant_id, created_at DESC);

ALTER TABLE food_wallet_payment_sessions
  ADD COLUMN IF NOT EXISTS wallet_hold_id UUID REFERENCES food_customer_wallet_holds(id) ON DELETE SET NULL;

COMMENT ON TABLE food_customer_wallet_holds IS
  'Temporary reservations against the available balance of a restaurant-scoped customer wallet.';

COMMENT ON TABLE food_customer_wallet_transfers IS
  'Atomic same-restaurant customer credit gifts/transfers with linked debit and credit ledger entries.';
