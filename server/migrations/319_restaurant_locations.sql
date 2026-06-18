-- Migration 319: Multi-location storefronts per restaurant brand.

CREATE TABLE IF NOT EXISTS restaurant_locations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  address_street VARCHAR(255),
  address_city VARCHAR(120),
  address_state VARCHAR(120),
  address_zip VARCHAR(40),
  address_country VARCHAR(2) NOT NULL DEFAULT 'US',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  phone VARCHAR(40),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'closed')),
  operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_locations_restaurant
  ON restaurant_locations(restaurant_id, status, is_primary DESC, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_locations_one_primary
  ON restaurant_locations(restaurant_id)
  WHERE is_primary = TRUE;
