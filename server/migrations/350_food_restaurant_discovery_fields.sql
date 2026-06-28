-- Migration 350: Durable restaurant discovery fields.
-- These columns let mobile/home discovery read production restaurant metadata
-- directly instead of hardcoding display defaults in API controllers.

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_level VARCHAR(16) NOT NULL DEFAULT 'mid',
  ADD COLUMN IF NOT EXISTS estimated_delivery_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_avg_rating_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_avg_rating_range
      CHECK (avg_rating >= 0 AND avg_rating <= 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_rating_count_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_rating_count_nonnegative
      CHECK (rating_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_price_level_allowed'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_price_level_allowed
      CHECK (price_level IN ('cheap', 'mid', 'expensive'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_delivery_minutes_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_delivery_minutes_range
      CHECK (estimated_delivery_minutes IS NULL OR estimated_delivery_minutes BETWEEN 1 AND 240);
  END IF;
END $$;

UPDATE food_restaurants
   SET estimated_delivery_minutes = COALESCE(estimated_delivery_minutes, prep_time_min, 30)
 WHERE estimated_delivery_minutes IS NULL;

UPDATE food_restaurants fr
   SET avg_rating = COALESCE(review_rollup.avg_rating, 0),
       rating_count = COALESCE(review_rollup.rating_count, 0)
  FROM (
    SELECT restaurant_id,
           ROUND(AVG(rating)::numeric, 2) AS avg_rating,
           COUNT(*)::int AS rating_count
      FROM food_reviews
     GROUP BY restaurant_id
  ) review_rollup
 WHERE fr.id = review_rollup.restaurant_id;

CREATE INDEX IF NOT EXISTS idx_food_restaurants_discovery_rating
  ON food_restaurants(status, avg_rating DESC, rating_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_price_level
  ON food_restaurants(price_level);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_dietary_tags
  ON food_restaurants USING GIN (dietary_tags);

CREATE OR REPLACE FUNCTION refresh_food_restaurant_rating(p_restaurant_id BIGINT)
RETURNS VOID AS $$
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE food_restaurants fr
     SET avg_rating = COALESCE(review_rollup.avg_rating, 0),
         rating_count = COALESCE(review_rollup.rating_count, 0),
         updated_at = NOW()
    FROM (
      SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating,
             COUNT(*)::int AS rating_count
        FROM food_reviews
       WHERE restaurant_id = p_restaurant_id
    ) review_rollup
   WHERE fr.id = p_restaurant_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_food_restaurant_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM refresh_food_restaurant_rating(OLD.restaurant_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM refresh_food_restaurant_rating(NEW.restaurant_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_food_reviews_refresh_restaurant_rating ON food_reviews;
CREATE TRIGGER trg_food_reviews_refresh_restaurant_rating
  AFTER INSERT OR UPDATE OR DELETE ON food_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_food_restaurant_rating();
