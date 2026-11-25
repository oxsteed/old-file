-- Group 13 Slice 4h (689, D-397/D-399): per-location period-close reviews.
-- One row per (restaurant, location, currency, period): the location's
-- recorded review of its period summary, differences, and adjustments,
-- presented before the settlement cycle closes. The review is a snapshot of
-- the derived summary at review time; it never approves, bypasses, or
-- replaces the two-admin settlement approval, which stays exactly the
-- existing requestMoneyMovement('credit_settlement_approval') flow.
-- Additive only; safe to run twice.
CREATE TABLE IF NOT EXISTS oxsteed_credit_location_period_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_type VARCHAR(16) NOT NULL CHECK (reviewed_by_type IN ('cashier', 'participant')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start),
  CHECK (
    (reviewed_by_type = 'cashier' AND reviewed_by_device_id IS NOT NULL AND reviewed_by_user_id IS NULL)
    OR (reviewed_by_type = 'participant' AND reviewed_by_user_id IS NOT NULL AND reviewed_by_device_id IS NULL)
  ),
  UNIQUE (restaurant_id, location_id, currency_code, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_credit_location_period_reviews_location
  ON oxsteed_credit_location_period_reviews (restaurant_id, location_id, period_end DESC);
