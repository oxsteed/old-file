-- Phase 2: Migration 002 - Create markets table
-- OxSteed v2

BEGIN;

CREATE TABLE IF NOT EXISTS markets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  zipcodes TEXT[] NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  launched_at TIMESTAMPTZ NULL,
  license_operator_id INTEGER NULL,
  license_fee_monthly DECIMAL(10,2) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Springfield market
INSERT INTO markets (name, state, zipcodes, active, launched_at)
VALUES (
  'Springfield', 'OH',
  ARRAY['45501','45502','45503','45504','45505','45506','45507'],
  TRUE, NOW()
) ON CONFLICT DO NOTHING;

-- Set all existing users to Springfield market
UPDATE users SET market_id = 1 WHERE market_id IS NULL;

-- Add FK constraint
ALTER TABLE users
  ADD CONSTRAINT fk_users_market
  FOREIGN KEY (market_id) REFERENCES markets(id);

COMMIT;
