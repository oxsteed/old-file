-- Migration 160: Location-based premium pricing
-- ================================================================
-- Allows different premium subscription prices by country/location.
-- Supports regional pricing, currency conversion, and min/max price floors.

CREATE TABLE IF NOT EXISTS pricing_overrides (
  id              SERIAL PRIMARY KEY,
  country_code    VARCHAR(2) NOT NULL UNIQUE,  -- ISO 3166-1 alpha-2 (US, GB, DE, IN, etc.)
  price_cents     BIGINT NOT NULL,              -- Price in cents (500 = $5.00 USD equivalent)
  currency_code   VARCHAR(3) NOT NULL,          -- ISO 4217 (USD, EUR, GBP, INR, etc.)
  min_price_cents BIGINT,                       -- Optional floor price
  max_price_cents BIGINT,                       -- Optional ceiling price
  stripe_price_id VARCHAR(255),                 -- Stripe Price ID for this region
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_overrides_country_active
  ON pricing_overrides(country_code, is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_overrides_updated_at
  ON pricing_overrides(updated_at DESC);

-- Audit log for pricing changes
CREATE TABLE IF NOT EXISTS pricing_override_log (
  id              BIGSERIAL PRIMARY KEY,
  country_code    VARCHAR(2) NOT NULL,
  old_price_cents BIGINT,
  new_price_cents BIGINT,
  currency_code   VARCHAR(3),
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  ip_hash         VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_override_log_country
  ON pricing_override_log(country_code);
CREATE INDEX IF NOT EXISTS idx_pricing_override_log_created_at
  ON pricing_override_log(created_at DESC);

-- Seed default regional prices (based on USD $29/month PPP)
-- These are typical SaaS pricing guidelines for PPP adjustment
INSERT INTO pricing_overrides
  (country_code, price_cents, currency_code, is_active, created_at)
VALUES
  -- Default (fallback to US pricing)
  ('US', 2900, 'USD', TRUE, NOW()),
  ('CA', 3500, 'CAD', TRUE, NOW()),
  ('GB', 2300, 'GBP', TRUE, NOW()),
  ('DE', 2700, 'EUR', TRUE, NOW()),
  ('FR', 2700, 'EUR', TRUE, NOW()),
  ('ES', 2700, 'EUR', TRUE, NOW()),
  ('IT', 2700, 'EUR', TRUE, NOW()),
  ('NL', 2700, 'EUR', TRUE, NOW()),
  ('SE', 2900, 'SEK', TRUE, NOW()),
  ('CH', 3200, 'CHF', TRUE, NOW()),
  ('AU', 4500, 'AUD', TRUE, NOW()),
  ('NZ', 4700, 'NZD', TRUE, NOW()),
  ('JP', 3200, 'JPY', TRUE, NOW()),
  ('SG', 4200, 'SGD', TRUE, NOW()),
  ('HK', 2300, 'HKD', TRUE, NOW()),
  ('IN', 25000, 'INR', TRUE, NOW()),  -- PPP adjusted (~$3 USD equivalent)
  ('BR', 15000, 'BRL', TRUE, NOW()),  -- PPP adjusted (~$3 USD equivalent)
  ('MX', 59000, 'MXN', TRUE, NOW()), -- PPP adjusted (~$3 USD equivalent)
  ('AR', 10000, 'ARS', TRUE, NOW()), -- PPP adjusted (~$3 USD equivalent)
  ('ZA', 5500, 'ZAR', TRUE, NOW()),  -- PPP adjusted (~$3 USD equivalent)
  ('NG', 14000, 'NGN', TRUE, NOW()), -- PPP adjusted (~$3 USD equivalent)
  ('PH', 1600, 'PHP', TRUE, NOW()),  -- PPP adjusted (~$3 USD equivalent)
  ('TH', 10500, 'THB', TRUE, NOW()), -- PPP adjusted (~$3 USD equivalent)
  ('VN', 670000, 'VND', TRUE, NOW()) -- PPP adjusted (~$3 USD equivalent)
ON CONFLICT (country_code) DO NOTHING;

COMMIT;
