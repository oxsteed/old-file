-- Existing single-store restaurants and new onboarding need a physical
-- default before the legacy 86 route can write a store override. Preserve all
-- configured stores; copy the brand's current address/hours only when none exist.
CREATE OR REPLACE FUNCTION restaurant_ensure_default_store(restaurant_key BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE store_key BIGINT;
BEGIN
  IF EXISTS(SELECT 1 FROM restaurant_locations WHERE restaurant_id=restaurant_key) THEN RETURN; END IF;
  INSERT INTO restaurant_locations(restaurant_id,name,address_street,address_city,
    address_state,address_zip,address_country,latitude,longitude,timezone,phone,
    is_primary,status,operating_hours)
  SELECT fr.id,fr.display_name,fr.address_street,fr.address_city,fr.address_state,
    fr.address_zip,COALESCE(fr.address_country,'US'),fr.latitude,fr.longitude,
    COALESCE(NULLIF(fr.timezone,''),'UTC'),fr.phone,TRUE,'active',COALESCE(fr.operating_hours,'{}'::jsonb)
  FROM food_restaurants fr WHERE fr.id=restaurant_key RETURNING id INTO store_key;
  IF store_key IS NULL THEN RETURN; END IF;
  -- These restaurants previously had no stores. Their legacy records belong
  -- to this sole store. Preserve issued queue numbers when switching scope.
  UPDATE food_orders SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
  UPDATE restaurant_pos_payments SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
  UPDATE restaurant_pos_shifts SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
  UPDATE restaurant_printer_jobs SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
  UPDATE restaurant_inventory_items SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
  UPDATE restaurant_daily_counters SET location_id=store_key WHERE restaurant_id=restaurant_key AND location_id IS NULL;
END $$;
SELECT restaurant_ensure_default_store(id) FROM food_restaurants;
CREATE OR REPLACE FUNCTION restaurant_default_store_created() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM restaurant_ensure_default_store(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS restaurant_default_store_created ON food_restaurants;
CREATE TRIGGER restaurant_default_store_created AFTER INSERT ON food_restaurants
  FOR EACH ROW EXECUTE FUNCTION restaurant_default_store_created();

-- F-02/F-17: store menu overrides, without changing the brand menu.
-- Composite foreign keys prevent a menu item or store from another tenant
-- being attached even by an incorrect writer.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_locations_restaurant_id_id
  ON restaurant_locations(restaurant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS food_menu_items_restaurant_id_id
  ON food_menu_items(restaurant_id, id);

CREATE TABLE IF NOT EXISTS restaurant_store_menu_overrides (
  restaurant_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  menu_item_id BIGINT NOT NULL,
  price_cents INTEGER CHECK (price_cents >= 0),
  is_available BOOLEAN,
  available_again_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, location_id, menu_item_id),
  FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES food_menu_items(restaurant_id, id) ON DELETE CASCADE,
  CHECK (available_again_at IS NULL OR is_available IS FALSE)
);

-- The existing screen stream remains the single realtime/outbox lifecycle.
CREATE OR REPLACE FUNCTION restaurant_store_menu_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM restaurant_screen_record_change(NEW.restaurant_id, NEW.location_id,
    'store_menu', NEW.menu_item_id::text);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS restaurant_store_menu_screen_change ON restaurant_store_menu_overrides;
CREATE TRIGGER restaurant_store_menu_screen_change AFTER INSERT OR UPDATE
  ON restaurant_store_menu_overrides FOR EACH ROW EXECUTE FUNCTION restaurant_store_menu_changed();
