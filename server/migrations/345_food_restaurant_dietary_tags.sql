-- Migration 345: Restaurant-level dietary tags for live dietary-filter sync.
-- Additive. Powers the customer-facing dietary filter chips so they can filter
-- live API restaurants (vegan / vegetarian / gluten_free / halal).

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

-- GIN index so "restaurants offering tag X" filters stay fast.
CREATE INDEX IF NOT EXISTS idx_food_restaurants_dietary_tags
  ON food_restaurants USING GIN (dietary_tags);
