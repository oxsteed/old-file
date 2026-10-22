-- Migration 996: one canonical device identity (F-26 convergence).
--
-- Three device/pairing systems coexist: restaurant_app_devices (pairing codes
-- + device tokens, also used by managed screens v2), display_pairings (PR #612
-- TV claim flow), and ad-hoc hub devices. This adds restaurant_devices as the
-- single registry every surface reads: role, store and capabilities in one
-- row. The legacy tables stay as the pairing-flow sources of truth behind
-- adapters (see docs/restaurant-device-convergence.md); this table is the
-- read model new code (hubs, HQ console, printer claiming) joins against.

CREATE TABLE IF NOT EXISTS restaurant_devices (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  device_role VARCHAR(32) NOT NULL
    CHECK (device_role IN ('pos','kitchen','display','kiosk','printer','runner','manager','hub','inventory','crew')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  pairing_source VARCHAR(32) NOT NULL
    CHECK (pairing_source IN ('app_device','display_pairing','hub','manual')),
  source_app_device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  source_display_pairing_id BIGINT REFERENCES display_pairings(id) ON DELETE SET NULL,
  -- Stable deduplication key: '<source>:<source id>', e.g. 'app_device:42'.
  source_key TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  last_seen_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_devices_source
  ON restaurant_devices (restaurant_id, source_key);
CREATE INDEX IF NOT EXISTS idx_restaurant_devices_store_role
  ON restaurant_devices (restaurant_id, location_id, device_role, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_devices_last_seen
  ON restaurant_devices (restaurant_id, last_seen_at DESC);

-- Backfill from the app-device pairing flow (covers managed screens v2, which
-- authenticates through restaurant_app_devices).
INSERT INTO restaurant_devices
  (restaurant_id, location_id, device_role, capabilities, pairing_source,
   source_app_device_id, source_key, status, last_seen_at)
SELECT
  d.restaurant_id,
  d.location_id,
  CASE d.app_key
    WHEN 'manager' THEN 'manager'
    WHEN 'pos' THEN 'pos'
    WHEN 'kitchen' THEN 'kitchen'
    WHEN 'display' THEN 'display'
    WHEN 'inventory' THEN 'inventory'
    WHEN 'crew' THEN 'crew'
    WHEN 'runner' THEN 'runner'
    WHEN 'restaurant' THEN 'manager'
    ELSE 'pos'
  END,
  COALESCE(d.config, '{}'::jsonb) || jsonb_build_object('app_key', d.app_key, 'mode', d.mode),
  'app_device',
  d.id,
  'app_device:' || d.id,
  CASE WHEN d.status = 'disabled' THEN 'disabled' ELSE 'active' END,
  d.last_seen_at
FROM restaurant_app_devices d
WHERE NOT EXISTS (
  SELECT 1 FROM restaurant_devices r
   WHERE r.restaurant_id = d.restaurant_id AND r.source_key = 'app_device:' || d.id
);

-- Backfill claimed TV displays from the PR #612 pairing flow.
INSERT INTO restaurant_devices
  (restaurant_id, location_id, device_role, capabilities, pairing_source,
   source_display_pairing_id, source_key, status, last_seen_at)
SELECT
  p.restaurant_id,
  p.location_id,
  'display',
  jsonb_build_object('display', true, 'label', p.label, 'pairing', 'display_pairing'),
  'display_pairing',
  p.id,
  'display_pairing:' || p.id,
  'active',
  p.last_seen_at
FROM display_pairings p
WHERE p.paired_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM restaurant_devices r
     WHERE r.restaurant_id = p.restaurant_id AND r.source_key = 'display_pairing:' || p.id
  );

-- Keep the registry in sync going forward: pairing flows keep writing their
-- own tables (live flows must not break); triggers mirror new rows here.
CREATE OR REPLACE FUNCTION restaurant_device_registry_from_app_device() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE role_key TEXT;
BEGIN
  role_key := CASE NEW.app_key
    WHEN 'manager' THEN 'manager' WHEN 'pos' THEN 'pos' WHEN 'kitchen' THEN 'kitchen'
    WHEN 'display' THEN 'display' WHEN 'inventory' THEN 'inventory' WHEN 'crew' THEN 'crew'
    WHEN 'runner' THEN 'runner' WHEN 'restaurant' THEN 'manager' ELSE 'pos' END;
  INSERT INTO restaurant_devices
    (restaurant_id, location_id, device_role, capabilities, pairing_source,
     source_app_device_id, source_key, status, last_seen_at)
  VALUES
    (NEW.restaurant_id, NEW.location_id, role_key,
     COALESCE(NEW.config, '{}'::jsonb) || jsonb_build_object('app_key', NEW.app_key, 'mode', NEW.mode),
     'app_device', NEW.id, 'app_device:' || NEW.id,
     CASE WHEN NEW.status = 'disabled' THEN 'disabled' ELSE 'active' END,
     NEW.last_seen_at)
  ON CONFLICT (restaurant_id, source_key) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    device_role = EXCLUDED.device_role,
    capabilities = EXCLUDED.capabilities,
    status = EXCLUDED.status,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_device_registry_app_device ON restaurant_app_devices;
CREATE TRIGGER restaurant_device_registry_app_device
  AFTER INSERT OR UPDATE ON restaurant_app_devices
  FOR EACH ROW EXECUTE FUNCTION restaurant_device_registry_from_app_device();

CREATE OR REPLACE FUNCTION restaurant_device_registry_from_display_pairing() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paired_at IS NULL THEN RETURN NEW; END IF;
  INSERT INTO restaurant_devices
    (restaurant_id, location_id, device_role, capabilities, pairing_source,
     source_display_pairing_id, source_key, status, last_seen_at)
  VALUES
    (NEW.restaurant_id, NEW.location_id, 'display',
     jsonb_build_object('display', true, 'label', NEW.label, 'pairing', 'display_pairing'),
     'display_pairing', NEW.id, 'display_pairing:' || NEW.id,
     'active', NEW.last_seen_at)
  ON CONFLICT (restaurant_id, source_key) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    capabilities = EXCLUDED.capabilities,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_device_registry_display_pairing ON display_pairings;
CREATE TRIGGER restaurant_device_registry_display_pairing
  AFTER INSERT OR UPDATE ON display_pairings
  FOR EACH ROW EXECUTE FUNCTION restaurant_device_registry_from_display_pairing();
