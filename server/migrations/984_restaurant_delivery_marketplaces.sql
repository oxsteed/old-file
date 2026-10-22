-- Migration 984: provider-neutral delivery marketplace contracts.
-- Provider credentials are references into the deployment secret store only;
-- no access token or webhook secret is stored in this database.

CREATE TABLE IF NOT EXISTS restaurant_delivery_marketplace_integrations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('doordash', 'uber_eats', 'grubhub')),
  external_location_id VARCHAR(180) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled', 'disabled', 'error')),
  credential_secret_ref TEXT,
  webhook_secret_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_menu_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, provider)
);

CREATE TABLE IF NOT EXISTS restaurant_delivery_marketplace_orders (
  id BIGSERIAL PRIMARY KEY,
  integration_id BIGINT NOT NULL REFERENCES restaurant_delivery_marketplace_integrations(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  external_order_id VARCHAR(180) NOT NULL,
  local_food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'accepted', 'rejected', 'preparing', 'ready', 'picked_up', 'cancelled', 'failed')),
  currency_code CHAR(3) NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (integration_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_delivery_marketplace_orders_queue
  ON restaurant_delivery_marketplace_orders (restaurant_id, status, received_at DESC);

CREATE OR REPLACE FUNCTION restaurant_delivery_marketplace_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_delivery_marketplace_integration_updated_at
  ON restaurant_delivery_marketplace_integrations;
CREATE TRIGGER restaurant_delivery_marketplace_integration_updated_at
  BEFORE UPDATE ON restaurant_delivery_marketplace_integrations
  FOR EACH ROW EXECUTE FUNCTION restaurant_delivery_marketplace_updated_at();

DROP TRIGGER IF EXISTS restaurant_delivery_marketplace_order_updated_at
  ON restaurant_delivery_marketplace_orders;
CREATE TRIGGER restaurant_delivery_marketplace_order_updated_at
  BEFORE UPDATE ON restaurant_delivery_marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION restaurant_delivery_marketplace_updated_at();
