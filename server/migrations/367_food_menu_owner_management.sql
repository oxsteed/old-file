-- Long-term restaurant menu management: safe archiving, draft publishing,
-- and optional item-level availability schedules.

ALTER TABLE food_menu_items
  ADD COLUMN IF NOT EXISTS publication_status VARCHAR(16) NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'food_menu_items_publication_status_check'
  ) THEN
    ALTER TABLE food_menu_items
      ADD CONSTRAINT food_menu_items_publication_status_check
      CHECK (publication_status IN ('draft', 'published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_menu_items_owner_state
  ON food_menu_items(restaurant_id, archived_at, publication_status, category_id, sort_order);
