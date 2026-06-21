-- Remember a specific physical restaurant for Runner while preserving the
-- existing business-level workspace context used by the website.
ALTER TABLE user_workspace_contexts
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_uwc_user_restaurant
  ON user_workspace_contexts (user_id, restaurant_id)
  WHERE restaurant_id IS NOT NULL;
