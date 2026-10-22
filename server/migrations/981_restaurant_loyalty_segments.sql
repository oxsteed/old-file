-- Migration 981: restaurant-scoped loyalty/CRM audience segments.
-- Segment definitions contain aggregate criteria only. Campaign delivery and
-- customer exports remain separate, explicitly opt-in products.

CREATE TABLE IF NOT EXISTS restaurant_loyalty_segments (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_segments_restaurant
  ON restaurant_loyalty_segments (restaurant_id, is_active, updated_at DESC);
