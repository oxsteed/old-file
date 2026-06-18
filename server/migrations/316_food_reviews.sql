-- Migration 316: OxSteed Restaurants order reviews + star ratings.
-- One review per completed order; aggregated on restaurant discovery.

CREATE TABLE IF NOT EXISTS food_reviews (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_food_reviews_restaurant_created
  ON food_reviews(restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_reviews_customer
  ON food_reviews(customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
