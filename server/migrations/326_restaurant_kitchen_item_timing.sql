-- Migration 326: Restaurant kitchen item timing and richer KDS statuses.
-- Adds station-level prep timing, delay/problem reasons, and expands the item
-- kitchen status enum used by Kitchen's live board actions.

ALTER TABLE food_order_items
  ADD COLUMN IF NOT EXISTS kitchen_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delayed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delay_reason TEXT,
  ADD COLUMN IF NOT EXISTS target_prep_seconds INTEGER CHECK (target_prep_seconds IS NULL OR target_prep_seconds >= 0),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'food_order_items'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kitchen_status%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE food_order_items DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE food_order_items
    ADD CONSTRAINT food_order_items_kitchen_status_check
    CHECK (kitchen_status IN ('queued','preparing','ready','held','bumped','delayed','problem','cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_food_order_items_kitchen_status
  ON food_order_items(order_id, kitchen_status, station_label);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_order_items_updated_at') THEN
    CREATE TRIGGER trg_food_order_items_updated_at
      BEFORE UPDATE ON food_order_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
