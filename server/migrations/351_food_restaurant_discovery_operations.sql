-- Migration 351: Restaurant discovery operations and ranking signals.
-- Adds safe, additive fields for customer discovery, temporary closures,
-- featured ordering, delivery metadata, and cached popularity signals.

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_rank INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS discovery_status VARCHAR(24) NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS is_accepting_orders_now BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS temporarily_closed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS minimum_order_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_area_radius_meters INTEGER,
  ADD COLUMN IF NOT EXISTS order_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ordered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_featured_rank_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_featured_rank_nonnegative
      CHECK (featured_rank >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_discovery_status_allowed'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_discovery_status_allowed
      CHECK (discovery_status IN ('visible', 'hidden', 'waitlist', 'internal_only'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_minimum_order_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_minimum_order_nonnegative
      CHECK (minimum_order_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_delivery_fee_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_delivery_fee_nonnegative
      CHECK (delivery_fee_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_service_area_radius_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_service_area_radius_range
      CHECK (service_area_radius_meters IS NULL OR service_area_radius_meters BETWEEN 0 AND 200000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_order_count_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_order_count_nonnegative
      CHECK (order_count >= 0);
  END IF;
END $$;

UPDATE food_restaurants fr
   SET order_count = COALESCE(order_rollup.order_count, 0),
       last_ordered_at = order_rollup.last_ordered_at
  FROM (
    SELECT restaurant_id,
           COUNT(*)::int AS order_count,
           MAX(created_at) AS last_ordered_at
      FROM food_orders
     WHERE status <> 'cancelled'
     GROUP BY restaurant_id
  ) order_rollup
 WHERE fr.id = order_rollup.restaurant_id;

UPDATE food_restaurants fr
   SET last_reviewed_at = review_rollup.last_reviewed_at
  FROM (
    SELECT restaurant_id,
           MAX(created_at) AS last_reviewed_at
      FROM food_reviews
     GROUP BY restaurant_id
  ) review_rollup
 WHERE fr.id = review_rollup.restaurant_id;

CREATE INDEX IF NOT EXISTS idx_food_restaurants_discovery_visibility
  ON food_restaurants(discovery_status, status, is_accepting_orders_now, is_featured, featured_rank);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_featured
  ON food_restaurants(is_featured, featured_rank, avg_rating DESC, rating_count DESC)
  WHERE discovery_status = 'visible' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_food_restaurants_popularity
  ON food_restaurants(order_count DESC, last_ordered_at DESC, avg_rating DESC)
  WHERE discovery_status = 'visible' AND status = 'active';

CREATE OR REPLACE FUNCTION refresh_food_restaurant_order_stats(p_restaurant_id BIGINT)
RETURNS VOID AS $$
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE food_restaurants fr
     SET order_count = COALESCE(order_rollup.order_count, 0),
         last_ordered_at = order_rollup.last_ordered_at,
         updated_at = NOW()
    FROM (
      SELECT COUNT(*)::int AS order_count,
             MAX(created_at) AS last_ordered_at
        FROM food_orders
       WHERE restaurant_id = p_restaurant_id
         AND status <> 'cancelled'
    ) order_rollup
   WHERE fr.id = p_restaurant_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_food_restaurant_order_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM refresh_food_restaurant_order_stats(OLD.restaurant_id);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM refresh_food_restaurant_order_stats(NEW.restaurant_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_food_orders_refresh_restaurant_order_stats ON food_orders;
CREATE TRIGGER trg_food_orders_refresh_restaurant_order_stats
  AFTER INSERT OR UPDATE OR DELETE ON food_orders
  FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_food_restaurant_order_stats();

CREATE OR REPLACE FUNCTION refresh_food_restaurant_rating(p_restaurant_id BIGINT)
RETURNS VOID AS $$
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE food_restaurants fr
     SET avg_rating = COALESCE(review_rollup.avg_rating, 0),
         rating_count = COALESCE(review_rollup.rating_count, 0),
         last_reviewed_at = review_rollup.last_reviewed_at,
         updated_at = NOW()
    FROM (
      SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating,
             COUNT(*)::int AS rating_count,
             MAX(created_at) AS last_reviewed_at
        FROM food_reviews
       WHERE restaurant_id = p_restaurant_id
    ) review_rollup
   WHERE fr.id = p_restaurant_id;
END;
$$ LANGUAGE plpgsql;
