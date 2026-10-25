ALTER TABLE restaurant_pos_payments ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_pos_connected_intent ON restaurant_pos_payments(provider_account_id,provider_payment_intent_id)
  WHERE provider_account_id IS NOT NULL AND payment_type='card';
CREATE TABLE IF NOT EXISTS restaurant_terminal_offline_permits (
  id UUID PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id),
  device_id BIGINT NOT NULL REFERENCES restaurant_devices(id),
  food_order_id BIGINT NOT NULL UNIQUE REFERENCES food_orders(id),
  shift_id BIGINT NOT NULL REFERENCES restaurant_pos_shifts(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  currency_code VARCHAR(3) NOT NULL,
  provider_account_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  provider_payment_intent_id TEXT,
  pos_payment_id BIGINT REFERENCES restaurant_pos_payments(id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','forwarded','captured','declined','requires_reconciliation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_terminal_offline_intent ON restaurant_terminal_offline_permits(provider_account_id,provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;
