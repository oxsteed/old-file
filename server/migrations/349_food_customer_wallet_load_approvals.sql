-- Migration 349: Pending approval workflow for high-value restaurant wallet loads.
-- Large stored-value credits should support maker-checker review before posting
-- to the immutable customer wallet ledger.

CREATE TABLE IF NOT EXISTS food_customer_wallet_load_requests (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'cancelled', 'expired')),
  note VARCHAR(255),
  reference_id VARCHAR(120),
  idempotency_key VARCHAR(120),
  correlation_id VARCHAR(120),
  request_ip INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_wallet_load_requests_restaurant_status
  ON food_customer_wallet_load_requests (restaurant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_wallet_load_requests_customer
  ON food_customer_wallet_load_requests (customer_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_wallet_load_requests_idempotency
  ON food_customer_wallet_load_requests (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_food_wallet_load_requests_currency_code'
       AND conrelid = 'food_customer_wallet_load_requests'::regclass
  ) THEN
    ALTER TABLE food_customer_wallet_load_requests
      ADD CONSTRAINT chk_food_wallet_load_requests_currency_code
      CHECK (currency_code ~ '^[A-Z]{3}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_food_wallet_load_requests_distinct_approver'
       AND conrelid = 'food_customer_wallet_load_requests'::regclass
  ) THEN
    ALTER TABLE food_customer_wallet_load_requests
      ADD CONSTRAINT chk_food_wallet_load_requests_distinct_approver
      CHECK (
        approved_by_user_id IS NULL
        OR requested_by_user_id IS NULL
        OR approved_by_user_id <> requested_by_user_id
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_food_wallet_load_requests_status_consistency'
       AND conrelid = 'food_customer_wallet_load_requests'::regclass
  ) THEN
    ALTER TABLE food_customer_wallet_load_requests
      ADD CONSTRAINT chk_food_wallet_load_requests_status_consistency
      CHECK (
        (
          status = 'pending'
          AND approved_by_user_id IS NULL
          AND approved_at IS NULL
          AND cancelled_by_user_id IS NULL
          AND cancelled_at IS NULL
        )
        OR (
          status = 'approved'
          AND approved_by_user_id IS NOT NULL
          AND approved_at IS NOT NULL
          AND cancelled_by_user_id IS NULL
          AND cancelled_at IS NULL
        )
        OR (
          status = 'cancelled'
          AND approved_by_user_id IS NULL
          AND approved_at IS NULL
          AND cancelled_by_user_id IS NOT NULL
          AND cancelled_at IS NOT NULL
        )
        OR (
          status = 'expired'
          AND approved_by_user_id IS NULL
          AND approved_at IS NULL
          AND cancelled_by_user_id IS NULL
          AND cancelled_at IS NULL
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_touch_food_customer_wallet_load_requests()
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
     WHERE tgname = 'trg_food_wallet_load_requests_updated_at'
  ) THEN
    CREATE TRIGGER trg_food_wallet_load_requests_updated_at
      BEFORE UPDATE ON food_customer_wallet_load_requests
      FOR EACH ROW
      EXECUTE FUNCTION trg_touch_food_customer_wallet_load_requests();
  END IF;
END $$;

COMMENT ON TABLE food_customer_wallet_load_requests IS
  'Maker-checker queue for high-value customer restaurant wallet credit loads before immutable ledger posting.';
