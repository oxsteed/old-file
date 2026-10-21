-- Item-level tax policy. NULL rate inherits the selected store/restaurant
-- rate; tax_exempt explicitly removes the item from the taxable base.
ALTER TABLE food_menu_items
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER,
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'food_menu_items_tax_rate_bps_valid') THEN
    ALTER TABLE food_menu_items ADD CONSTRAINT food_menu_items_tax_rate_bps_valid
      CHECK (tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_menu_items_tax_policy
  ON food_menu_items(restaurant_id, tax_exempt, tax_rate_bps);
