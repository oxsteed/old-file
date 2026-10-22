-- Migration 999: store-and-forward card risk-limit configuration (F-08).
--
-- Schema ONLY. Offline card authorization (store-and-forward) settles real
-- money without an online authorization, so the settlement worker is NOT built
-- here: enabling it needs the product owner's explicit risk call (per-sale and
-- per-day caps, allowed card brands, dispute liability). This table holds the
-- limits so the decision can be encoded later without a schema change.
-- The feature flag stays OFF and the server refuses to arm the mode until the
-- settlement path exists.

CREATE TABLE IF NOT EXISTS restaurant_store_forward_settings (
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_transaction_cents INTEGER NOT NULL DEFAULT 5000 CHECK (max_transaction_cents > 0),
  max_daily_cents INTEGER NOT NULL DEFAULT 50000 CHECK (max_daily_cents > 0),
  allowed_card_brands TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  require_manager_pin_above_cents INTEGER CHECK (require_manager_pin_above_cents IS NULL OR require_manager_pin_above_cents > 0),
  settlement_mode VARCHAR(24) NOT NULL DEFAULT 'manual_review'
    CHECK (settlement_mode IN ('manual_review', 'automatic')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, location_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_store_forward_settings_location_fk'
       AND conrelid = 'restaurant_store_forward_settings'::regclass
  ) THEN
    ALTER TABLE restaurant_store_forward_settings
      ADD CONSTRAINT restaurant_store_forward_settings_location_fk
      FOREIGN KEY (restaurant_id, location_id)
      REFERENCES restaurant_locations(restaurant_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;
