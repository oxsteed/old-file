-- Migration 346: Customer restaurant wallets for OxSteed Main.
-- Additive only. Creates a per-restaurant stored-value wallet with an
-- append-only ledger so customer delivery credit can be production-backed.

CREATE TABLE IF NOT EXISTS food_customer_wallet_accounts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_accounts_customer
  ON food_customer_wallet_accounts(customer_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_accounts_restaurant
  ON food_customer_wallet_accounts(restaurant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS food_customer_wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('credit', 'debit', 'refund', 'adjustment')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  description VARCHAR(255),
  reference_type VARCHAR(60),
  reference_id VARCHAR(120),
  idempotency_key VARCHAR(120),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_account
  ON food_customer_wallet_ledger(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_customer
  ON food_customer_wallet_ledger(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_reference
  ON food_customer_wallet_ledger(reference_type, reference_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_customer_wallet_ledger_idempotency
  ON food_customer_wallet_ledger(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_touch_food_customer_wallet_accounts()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_food_customer_wallet_accounts_updated_at'
  ) THEN
    CREATE TRIGGER trg_food_customer_wallet_accounts_updated_at
      BEFORE UPDATE ON food_customer_wallet_accounts
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_food_customer_wallet_accounts();
  END IF;
END $$;

-- Immutable ledger: wallet movements are append-only.
CREATE OR REPLACE RULE food_customer_wallet_ledger_no_update AS
  ON UPDATE TO food_customer_wallet_ledger DO INSTEAD NOTHING;

CREATE OR REPLACE RULE food_customer_wallet_ledger_no_delete AS
  ON DELETE TO food_customer_wallet_ledger DO INSTEAD NOTHING;
