-- Auth-audit finding 22: payroll labor/exceptions rollups aggregated across
-- all stores because declared cash tips carried no store attribution
-- (food_orders, restaurant_pos_payments, restaurant_pos_shifts and
-- restaurant_pos_drawer_events already have location_id). Add an optional
-- location_id so new declarations are store-attributed; historical rows
-- stay NULL and are excluded from location-scoped rollups (fail closed).
-- Additive; safe to re-run.

ALTER TABLE restaurant_declared_cash_tips
  ADD COLUMN IF NOT EXISTS location_id BIGINT
  REFERENCES restaurant_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_declared_cash_tips_location
  ON restaurant_declared_cash_tips (restaurant_id, location_id, business_date);
