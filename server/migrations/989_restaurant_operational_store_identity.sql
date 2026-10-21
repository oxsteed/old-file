-- Migration 989: mandatory store identity for operational records.
--
-- Migration 952 made store identity available across the main POS, order,
-- printer, shift, and inventory records. This follow-up closes the remaining
-- operational paths: paired devices, legacy display/printer settings, kitchen
-- and drawer audit records, approvals, inventory ledgers, and runner tasks.
-- Existing rows are assigned to the restaurant's primary store and all new
-- writes fail closed when a tenant-valid store cannot be resolved.

-- Every restaurant must have a physical store before a record can be written.
SELECT restaurant_ensure_default_store(id) FROM food_restaurants;

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE display_pairings
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_printer_settings
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_inventory_adjustments
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_kitchen_stations
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_kitchen_events
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_pos_drawer_events
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_pos_receipt_events
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_pos_approvals
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_runner_settlements
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_crew_tasks
  ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_crew_task_events
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

-- Backfill direct records from their more specific parent where possible.
UPDATE restaurant_app_devices d
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = d.restaurant_id AND l.is_primary = TRUE
   AND d.location_id IS NULL;
UPDATE display_pairings p
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = p.restaurant_id AND l.is_primary = TRUE
   AND p.location_id IS NULL;
UPDATE restaurant_printer_settings s
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = s.restaurant_id AND l.is_primary = TRUE
   AND s.location_id IS NULL;
UPDATE restaurant_inventory_adjustments a
   SET location_id = COALESCE((
     SELECT i.location_id
       FROM restaurant_inventory_items i
      WHERE i.id = a.item_id AND i.restaurant_id = a.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = a.restaurant_id AND l.is_primary = TRUE
   AND a.location_id IS NULL;
UPDATE restaurant_kitchen_stations s
   SET location_id = COALESCE((
     SELECT d.location_id
       FROM restaurant_app_devices d
      WHERE d.id = s.device_id AND d.restaurant_id = s.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = s.restaurant_id AND l.is_primary = TRUE
   AND s.location_id IS NULL;
UPDATE restaurant_kitchen_events e
   SET location_id = COALESCE((
     SELECT o.location_id
       FROM food_orders o
      WHERE o.id = e.food_order_id AND o.restaurant_id = e.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = e.restaurant_id AND l.is_primary = TRUE
   AND e.location_id IS NULL;
UPDATE restaurant_pos_drawer_events e
   SET location_id = COALESCE((
     SELECT s.location_id
       FROM restaurant_pos_shifts s
      WHERE s.id = e.shift_id AND s.restaurant_id = e.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = e.restaurant_id AND l.is_primary = TRUE
   AND e.location_id IS NULL;
UPDATE restaurant_pos_receipt_events e
   SET location_id = COALESCE((
     SELECT o.location_id
       FROM food_orders o
      WHERE o.id = e.food_order_id AND o.restaurant_id = e.restaurant_id
   ), l.id)
  FROM restaurant_locations l
 WHERE l.restaurant_id = e.restaurant_id AND l.is_primary = TRUE
   AND e.location_id IS NULL;
UPDATE restaurant_pos_approvals a
   SET location_id = COALESCE(
     (SELECT p.location_id FROM restaurant_pos_payments p WHERE p.id = a.payment_id AND p.restaurant_id = a.restaurant_id),
     (SELECT o.location_id FROM food_orders o WHERE o.id = a.food_order_id AND o.restaurant_id = a.restaurant_id),
     (SELECT s.location_id FROM restaurant_pos_shifts s WHERE s.id = a.shift_id AND s.restaurant_id = a.restaurant_id),
     l.id
   )
  FROM restaurant_locations l
 WHERE l.restaurant_id = a.restaurant_id AND l.is_primary = TRUE
   AND a.location_id IS NULL;
UPDATE restaurant_runner_settlements s
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = s.restaurant_id AND l.is_primary = TRUE
   AND s.location_id IS NULL;
UPDATE restaurant_crew_tasks t
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = t.restaurant_id AND l.is_primary = TRUE
   AND t.location_id IS NULL;
UPDATE restaurant_crew_task_events e
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = e.restaurant_id AND l.is_primary = TRUE
   AND e.location_id IS NULL;

-- Existing location columns from prior rollout migrations are backfilled for
-- any row created during the staged period after those migrations ran.
UPDATE restaurant_inventory_purchase_requests r
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = r.restaurant_id AND l.is_primary = TRUE AND r.location_id IS NULL;
UPDATE restaurant_inventory_supplier_issues i
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = i.restaurant_id AND l.is_primary = TRUE AND i.location_id IS NULL;
UPDATE restaurant_inventory_transfers t
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = t.restaurant_id AND l.is_primary = TRUE AND t.location_id IS NULL;
UPDATE restaurant_inventory_receipts r
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = r.restaurant_id AND l.is_primary = TRUE AND r.location_id IS NULL;

-- Composite foreign keys preserve the brand/store tenant boundary even when a
-- caller supplies an otherwise valid location id from another restaurant.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'food_orders', 'restaurant_pos_payments', 'restaurant_pos_shifts',
    'restaurant_printer_jobs', 'restaurant_inventory_items',
    'restaurant_app_devices', 'display_pairings', 'restaurant_printer_settings',
    'restaurant_inventory_adjustments', 'restaurant_kitchen_stations',
    'restaurant_kitchen_events', 'restaurant_pos_drawer_events',
    'restaurant_pos_receipt_events', 'restaurant_pos_approvals',
    'restaurant_runner_settlements', 'restaurant_crew_tasks',
    'restaurant_crew_task_events', 'restaurant_inventory_purchase_requests',
    'restaurant_inventory_supplier_issues', 'restaurant_inventory_transfers',
    'restaurant_inventory_receipts'
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

-- Resolve omitted store ids at the database boundary. Source records use a
-- parent-specific location first, then the primary store as the safe default.
CREATE OR REPLACE FUNCTION restaurant_fill_operational_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE payload JSONB := to_jsonb(NEW);
        restaurant_key BIGINT;
        resolved BIGINT;
        source_key BIGINT;
        source_kind TEXT := COALESCE(TG_ARGV[0], 'primary');
BEGIN
  restaurant_key := NULLIF(payload ->> 'restaurant_id', '')::BIGINT;
  IF NEW.location_id IS NULL AND source_kind = 'order' THEN
    source_key := NULLIF(payload ->> 'food_order_id', '')::BIGINT;
    SELECT location_id INTO resolved FROM food_orders WHERE id = source_key AND restaurant_id = restaurant_key;
  ELSIF NEW.location_id IS NULL AND source_kind = 'shift' THEN
    source_key := NULLIF(payload ->> 'shift_id', '')::BIGINT;
    SELECT location_id INTO resolved FROM restaurant_pos_shifts WHERE id = source_key AND restaurant_id = restaurant_key;
  ELSIF NEW.location_id IS NULL AND source_kind = 'item' THEN
    source_key := NULLIF(payload ->> 'item_id', '')::BIGINT;
    SELECT location_id INTO resolved FROM restaurant_inventory_items WHERE id = source_key AND restaurant_id = restaurant_key;
  ELSIF NEW.location_id IS NULL AND source_kind = 'device' THEN
    source_key := NULLIF(payload ->> 'device_id', '')::BIGINT;
    SELECT location_id INTO resolved FROM restaurant_app_devices WHERE id = source_key AND restaurant_id = restaurant_key;
  END IF;
  IF NEW.location_id IS NULL THEN NEW.location_id := resolved; END IF;
  IF NEW.location_id IS NULL THEN
    SELECT id INTO NEW.location_id
      FROM restaurant_locations
     WHERE restaurant_id = restaurant_key
     ORDER BY is_primary DESC, id ASC
     LIMIT 1;
  END IF;
  IF NEW.location_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM restaurant_locations
     WHERE restaurant_id = restaurant_key AND id = NEW.location_id
  ) THEN
    RAISE EXCEPTION 'operational record requires a store belonging to the restaurant';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name TEXT; source_kind TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'food_orders', 'restaurant_pos_payments', 'restaurant_pos_shifts',
    'restaurant_printer_jobs', 'restaurant_inventory_items',
    'restaurant_app_devices', 'display_pairings', 'restaurant_printer_settings',
    'restaurant_inventory_adjustments', 'restaurant_kitchen_stations',
    'restaurant_kitchen_events', 'restaurant_pos_drawer_events',
    'restaurant_pos_receipt_events', 'restaurant_pos_approvals',
    'restaurant_runner_settlements', 'restaurant_crew_tasks',
    'restaurant_crew_task_events', 'restaurant_inventory_purchase_requests',
    'restaurant_inventory_supplier_issues', 'restaurant_inventory_transfers',
    'restaurant_inventory_receipts'
  ] LOOP
    IF to_regclass(table_name) IS NULL THEN CONTINUE; END IF;
    source_kind := CASE
      WHEN table_name IN ('restaurant_pos_payments', 'restaurant_printer_jobs', 'restaurant_kitchen_events', 'restaurant_pos_receipt_events') THEN 'order'
      WHEN table_name IN ('restaurant_pos_drawer_events', 'restaurant_pos_approvals') THEN 'shift'
      WHEN table_name IN ('restaurant_inventory_adjustments', 'restaurant_inventory_transfers') THEN 'item'
      WHEN table_name = 'restaurant_kitchen_stations' THEN 'device'
      ELSE 'primary'
    END;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_operational_location', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF restaurant_id, location_id ON %I FOR EACH ROW EXECUTE FUNCTION restaurant_fill_operational_location(%L)', table_name || '_operational_location', table_name, source_kind);
  END LOOP;
END $$;

-- With legacy rows repaired and write-time resolution installed, operational
-- records cannot silently lose their store identity.
ALTER TABLE food_orders ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_payments ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_shifts ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_printer_jobs ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_items ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_app_devices ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE display_pairings ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_printer_settings ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_adjustments ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_kitchen_stations ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_kitchen_events ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_drawer_events ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_receipt_events ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_pos_approvals ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_runner_settlements ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_crew_tasks ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_crew_task_events ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_purchase_requests ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_supplier_issues ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_transfers ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE restaurant_inventory_receipts ALTER COLUMN location_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_operational_location
  ON food_orders (restaurant_id, location_id, created_at DESC);
