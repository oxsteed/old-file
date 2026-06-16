-- Migration 312: OxSteed Restaurants customer profile persistence.
-- Adds restaurant favorites + customer preference storage for the dedicated
-- customer ordering app. Reorder history is derived from food_orders.

CREATE TABLE IF NOT EXISTS food_customer_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_language VARCHAR(24) NOT NULL DEFAULT 'english'
    CHECK (preferred_language IN ('english', 'spanish', 'french', 'haitian_creole')),
  notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_customer_favorite_restaurants (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_food_customer_favorites_restaurant
  ON food_customer_favorite_restaurants(restaurant_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_customer_profiles_updated_at') THEN
    CREATE TRIGGER trg_food_customer_profiles_updated_at
      BEFORE UPDATE ON food_customer_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
