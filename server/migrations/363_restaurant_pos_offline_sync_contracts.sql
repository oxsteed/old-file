-- Migration 363: POS demo/local compatibility and offline sync contracts.
-- Adds a durable acknowledgement ledger for local POS pending operations and
-- keeps manual/direct POS payment types compatible with current route aliases.

ALTER TABLE restaurant_pos_payments
  DROP CONSTRAINT IF EXISTS restaurant_pos_payments_payment_type_check;

ALTER TABLE restaurant_pos_payments
  ADD CONSTRAINT restaurant_pos_payments_payment_type_check
  CHECK (payment_type IN (
    'cash',
    'card',
    'external',
    'gift_card',
    'wallet_credit',
    'comp',
    'refund'
  ));

ALTER TABLE restaurant_pos_payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS restaurant_pos_pending_operations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  client_operation_id VARCHAR(200) NOT NULL,
  operation_type VARCHAR(80) NOT NULL DEFAULT 'unknown',
  entity_type VARCHAR(80),
  entity_id VARCHAR(120),
  status VARCHAR(24) NOT NULL DEFAULT 'acked'
    CHECK (status IN ('received','acked','applied','failed')),
  error_code VARCHAR(80),
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, client_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_pending_operations_restaurant
  ON restaurant_pos_pending_operations (restaurant_id, status, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_pending_operations_device
  ON restaurant_pos_pending_operations (restaurant_id, device_id, acknowledged_at DESC)
  WHERE device_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_pos_pending_operations_updated_at') THEN
    CREATE TRIGGER trg_restaurant_pos_pending_operations_updated_at
      BEFORE UPDATE ON restaurant_pos_pending_operations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
