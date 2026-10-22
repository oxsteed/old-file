-- Migration 99910: per-store loyalty campaign and segment targeting.
-- Campaigns can target a subset of the restaurant's stores (location_ids);
-- NULL or an empty array keeps the legacy all-stores audience. Deliveries
-- carry the attributed store (location_id) for store-scoped reporting.

ALTER TABLE restaurant_loyalty_campaigns
  ADD COLUMN IF NOT EXISTS location_ids BIGINT[];

-- Guard the array contents: positive, non-null store ids only, bounded length,
-- and every id must belong to the campaign's restaurant. The service layer
-- pre-validates with a friendly 400; this trigger is the database backstop.
CREATE OR REPLACE FUNCTION restaurant_loyalty_campaign_location_ids_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.location_ids IS NOT NULL THEN
    IF cardinality(NEW.location_ids) > 200 THEN
      RAISE EXCEPTION 'loyalty campaign targets at most 200 stores';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.location_ids) AS store_id
      WHERE store_id IS NULL OR store_id <= 0
    ) THEN
      RAISE EXCEPTION 'loyalty campaign store ids must be positive integers';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.location_ids) AS store_id
      WHERE NOT EXISTS (
        SELECT 1 FROM restaurant_locations rl
        WHERE rl.restaurant_id = NEW.restaurant_id AND rl.id = store_id
      )
    ) THEN
      RAISE EXCEPTION 'loyalty campaign targets a store outside this restaurant';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_loyalty_campaign_location_ids_guard
  ON restaurant_loyalty_campaigns;
CREATE TRIGGER restaurant_loyalty_campaign_location_ids_guard
  BEFORE INSERT OR UPDATE OF restaurant_id, location_ids
  ON restaurant_loyalty_campaigns
  FOR EACH ROW EXECUTE FUNCTION restaurant_loyalty_campaign_location_ids_guard();

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_campaigns_locations
  ON restaurant_loyalty_campaigns USING GIN (location_ids);

ALTER TABLE restaurant_loyalty_campaign_deliveries
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_loyalty_campaign_deliveries_location_fk'
  ) THEN
    ALTER TABLE restaurant_loyalty_campaign_deliveries
      ADD CONSTRAINT restaurant_loyalty_campaign_deliveries_location_fk
      FOREIGN KEY (location_id) REFERENCES restaurant_locations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_campaign_deliveries_location
  ON restaurant_loyalty_campaign_deliveries (campaign_id, location_id);
