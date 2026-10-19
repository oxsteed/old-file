-- Network receipt printer (ESC/POS over TCP) settings for restaurant POS counters.
-- Additive. One settings row per restaurant (unique on restaurant_id); defaults
-- keep printing disabled until the owner configures a printer. The print path
-- is fire-and-forget: it reads settings and order snapshots and never writes
-- to order, payment, or ledger tables, so a printer failure can never block or
-- alter an order or payment.
CREATE TABLE IF NOT EXISTS restaurant_printer_settings (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  host TEXT,
  port INTEGER NOT NULL DEFAULT 9100,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  drawer_kick_on_cash BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_printer_settings_restaurant_id_uniq
  ON restaurant_printer_settings(restaurant_id);
