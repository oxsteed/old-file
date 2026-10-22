-- Migration 997: in-store hubs (F-08 offline resilience).
--
-- One designated device per store acts as the LAN hub: it relays POS/KDS/
-- printer traffic over the local network while the internet is down and syncs
-- with the cloud through the existing revision journal
-- (restaurant_screen_streams / restaurant_screen_events, migration 887).
-- The hub itself is a row in the unified device registry (migration 1302)
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
