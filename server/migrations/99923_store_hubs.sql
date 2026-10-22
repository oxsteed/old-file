-- Migration 99923: in-store hubs + store-and-forward settings (F-08 offline resilience).
--
-- One designated device per store acts as the LAN hub: it relays POS/KDS/
-- printer traffic over the local network while the internet is down and syncs
-- with the cloud through the existing revision journal
-- (restaurant_screen_streams / restaurant_screen_events, migration 887).
-- The hub itself is a row in the unified device registry (migration 99922)
-- with device_role = 'hub'.

CREATE TABLE IF NOT EXISTS store_hubs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  device_id BIGINT REFERENCES restaurant_devices(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  last_heartbeat_at TIMESTAMPTZ,
  last_pull_revision BIGINT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One hub per store: failover means re-designating, never two writers.
  CONSTRAINT uq_store_hubs_store UNIQUE (restaurant_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_store_hubs_device
  ON store_hubs (restaurant_id, device_id);
CREATE INDEX IF NOT EXISTS idx_store_hubs_heartbeat
  ON store_hubs (restaurant_id, status, last_heartbeat_at DESC);

-- A hub designation must point at a registry device of role 'hub' in the same
-- restaurant and store.
CREATE OR REPLACE FUNCTION store_hub_device_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE dev RECORD;
BEGIN
  IF NEW.device_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, restaurant_id, location_id, device_role, status INTO dev
    FROM restaurant_devices WHERE id = NEW.device_id;
  IF dev.id IS NULL THEN
    RAISE EXCEPTION 'Hub device % does not exist', NEW.device_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF dev.restaurant_id <> NEW.restaurant_id THEN
    RAISE EXCEPTION 'Hub device belongs to a different restaurant' USING ERRCODE = 'check_violation';
  END IF;
  IF dev.location_id IS NOT NULL AND dev.location_id <> NEW.location_id THEN
    RAISE EXCEPTION 'Hub device is assigned to a different store' USING ERRCODE = 'check_violation';
  END IF;
  IF dev.device_role <> 'hub' THEN
    RAISE EXCEPTION 'Designated hub device must have role hub' USING ERRCODE = 'check_violation';
  END IF;
  IF dev.status = 'disabled' THEN
    RAISE EXCEPTION 'Designated hub device is disabled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS store_hub_device_guard ON store_hubs;
CREATE TRIGGER store_hub_device_guard
  BEFORE INSERT OR UPDATE OF device_id, restaurant_id, location_id ON store_hubs
  FOR EACH ROW EXECUTE FUNCTION store_hub_device_guard();

-- Store-and-forward card risk-limit configuration (schema ONLY).
-- Schema ONLY. Offline card authorization (store-and-forward) settles real
-- money without an online authorization, so the settlement worker is NOT built
-- here: enabling it needs the product owner's explicit risk call (per-sale and
-- per-day caps, allowed card brands, dispute liability). This table holds the
-- limits so the decision can be encoded later without a schema change.
-- The feature flag stays OFF and the server refuses to arm the mode until the
-- settlement path exists.

CREATE TABLE IF NOT EXISTS restaurant_store_forward_settings (
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_transaction_cents INTEGER NOT NULL DEFAULT 5000 CHECK (max_transaction_cents > 0),
  max_daily_cents INTEGER NOT NULL DEFAULT 50000 CHECK (max_daily_cents > 0),
  allowed_card_brands TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  require_manager_pin_above_cents INTEGER CHECK (require_manager_pin_above_cents IS NULL OR require_manager_pin_above_cents > 0),
  settlement_mode VARCHAR(24) NOT NULL DEFAULT 'manual_review'
    CHECK (settlement_mode IN ('manual_review', 'automatic')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, location_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_store_forward_settings_location_fk'
       AND conrelid = 'restaurant_store_forward_settings'::regclass
  ) THEN
    ALTER TABLE restaurant_store_forward_settings
      ADD CONSTRAINT restaurant_store_forward_settings_location_fk
      FOREIGN KEY (restaurant_id, location_id)
      REFERENCES restaurant_locations(restaurant_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;
