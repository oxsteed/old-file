-- Migration 990: close the remaining store-boundary adapters.
-- 989 covered the primary order/POS/kitchen/ledger records. These queues and
-- parent-child operational records also need a tenant-valid store so a
-- replay, screen ticket, or runner task cannot cross locations silently.

ALTER TABLE restaurant_runner_tasks
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_screen_tickets
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_pos_pending_operations
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_inventory_order_reservations
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_crew_shifts
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

UPDATE restaurant_runner_tasks t
   SET location_id = COALESCE((
     SELECT o.location_id FROM food_orders o
      WHERE o.id = t.food_order_id AND o.restaurant_id = t.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = t.restaurant_id AND l.is_primary = TRUE
   AND t.location_id IS NULL;
UPDATE restaurant_screen_tickets t
   SET location_id = COALESCE((
     SELECT d.location_id FROM restaurant_app_devices d
      WHERE d.id = t.device_id AND d.restaurant_id = t.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = t.restaurant_id AND l.is_primary = TRUE
   AND t.location_id IS NULL;
UPDATE restaurant_pos_pending_operations p
   SET location_id = COALESCE((
     SELECT d.location_id FROM restaurant_app_devices d
      WHERE d.id = p.device_id AND d.restaurant_id = p.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = p.restaurant_id AND l.is_primary = TRUE
   AND p.location_id IS NULL;
UPDATE restaurant_inventory_order_reservations r
   SET location_id = COALESCE((
     SELECT o.location_id FROM food_orders o
      WHERE o.id = r.food_order_id AND o.restaurant_id = r.restaurant_id
   ), (
     SELECT i.location_id FROM restaurant_inventory_items i
      WHERE i.id = r.inventory_item_id AND i.restaurant_id = r.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = r.restaurant_id AND l.is_primary = TRUE
   AND r.location_id IS NULL;
UPDATE restaurant_crew_shifts s
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = s.restaurant_id AND l.is_primary = TRUE
   AND s.location_id IS NULL;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'restaurant_runner_tasks', 'restaurant_screen_tickets',
    'restaurant_pos_pending_operations', 'restaurant_inventory_order_reservations',
    'restaurant_crew_shifts'
  ] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = table_name || '_restaurant_location_fk'
         AND conrelid = table_name::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (restaurant_id, location_id) REFERENCES restaurant_locations(restaurant_id, id) ON DELETE RESTRICT',
        table_name, table_name || '_restaurant_location_fk'
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE table_name TEXT; source_kind TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'restaurant_runner_tasks', 'restaurant_screen_tickets',
    'restaurant_pos_pending_operations', 'restaurant_inventory_order_reservations',
    'restaurant_crew_shifts'
  ] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    source_kind := CASE
      WHEN table_name IN ('restaurant_runner_tasks', 'restaurant_inventory_order_reservations') THEN 'order'
      WHEN table_name IN ('restaurant_screen_tickets', 'restaurant_pos_pending_operations') THEN 'device'
      ELSE 'primary'
    END;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_operational_location', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF restaurant_id, location_id ON %I FOR EACH ROW EXECUTE FUNCTION restaurant_fill_operational_location(%L)', table_name || '_operational_location', table_name, source_kind);
  END LOOP;
END $$;

ALTER TABLE restaurant_runner_tasks ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_screen_tickets ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_pending_operations ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_order_reservations ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_crew_shifts ALTER COLUMN location_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_tasks_location
  ON restaurant_runner_tasks (restaurant_id, location_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_screen_tickets_location
  ON restaurant_screen_tickets (restaurant_id, location_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_restaurant_pos_pending_operations_location
  ON restaurant_pos_pending_operations (restaurant_id, location_id, status, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_reservations_location
  ON restaurant_inventory_order_reservations (restaurant_id, location_id, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_crew_shifts_location
  ON restaurant_crew_shifts (restaurant_id, location_id, starts_at DESC);
