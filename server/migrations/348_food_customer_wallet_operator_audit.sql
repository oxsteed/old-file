-- Migration 348: Harden customer restaurant wallets with operator audit
-- events and versioned hash metadata for ledger verification.

ALTER TABLE food_customer_wallet_ledger
  ADD COLUMN IF NOT EXISTS hash_algorithm VARCHAR(40);

UPDATE food_customer_wallet_ledger
   SET hash_algorithm = 'sha256_v0'
 WHERE hash_algorithm IS NULL
   AND entry_hash IS NOT NULL;

ALTER TABLE food_customer_wallet_ledger
  ALTER COLUMN hash_algorithm SET DEFAULT 'hmac_sha256_v1';

CREATE TABLE IF NOT EXISTS food_customer_wallet_operator_audit_events (
  id                BIGSERIAL PRIMARY KEY,
  restaurant_id     BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_id       BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  wallet_account_id BIGINT REFERENCES food_customer_wallet_accounts(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type       VARCHAR(80) NOT NULL,
  amount_cents      BIGINT,
  currency_code     VARCHAR(3),
  correlation_id    VARCHAR(120),
  request_ip        INET,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_operator_audit_restaurant_created
  ON food_customer_wallet_operator_audit_events (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_operator_audit_account_customer
  ON food_customer_wallet_operator_audit_events (wallet_account_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_operator_audit_operator
  ON food_customer_wallet_operator_audit_events (restaurant_id, operator_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_customer_wallet_operator_audit_correlation
  ON food_customer_wallet_operator_audit_events (restaurant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE food_customer_wallet_operator_audit_events IS
  'Append-only audit stream for privileged customer wallet actions such as merchant loads and integrity checks.';

CREATE OR REPLACE RULE food_customer_wallet_operator_audit_no_update AS
  ON UPDATE TO food_customer_wallet_operator_audit_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE food_customer_wallet_operator_audit_no_delete AS
  ON DELETE TO food_customer_wallet_operator_audit_events DO INSTEAD NOTHING;
