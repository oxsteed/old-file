BEGIN;

-- ——— Platform Fee Configuration ———————————————————————
-- Single source of truth for all runtime fee rates.
-- Super admin can update these from the dashboard.
-- feeCalculator.js reads from this table when present,
-- falls back to hardcoded constants if table is empty.

    CREATE TABLE IF NOT EXISTS fee_config (
  id              SERIAL       PRIMARY KEY,
  key             VARCHAR(100) NOT NULL UNIQUE,
  value           DECIMAL(10,4) NOT NULL,
  value_type      VARCHAR(20)  NOT NULL DEFAULT 'percentage',
  -- 'percentage' (0.10 = 10%) | 'cents' (500 = $5.00) | 'flat_dollars'
  label           VARCHAR(255) NOT NULL,
  description     TEXT,
  min_value       DECIMAL(10,4),
  max_value       DECIMAL(10,4),
  updated_by      UUID         REFERENCES users(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Seed default values matching feeCalculator.js constants
INSERT INTO fee_config
  (key, value, value_type, label, description, min_value, max_value)
VALUES
  ('tier3_platform_fee_pct',
    0.10,
    'percentage',
    'Tier 3 Platform Service Fee',
    'Percentage of job value charged as OxSteed platform fee. Applied to all Tier 3 protected transactions.',
    0.05,
    0.25),

  ('tier3_platform_fee_min_cents',
    500,
    'cents',
    'Tier 3 Minimum Platform Fee',
    'Minimum platform fee in cents regardless of job value. $5.00 = 500.',
    100,
    2000),

  ('tier3_protection_fee_pct',
    0.02,
    'percentage',
    'Payment Protection Fee',
    'Percentage charged to cover Stripe processing and escrow administration.',
    0.01,
    0.05),

  ('tier3_broker_cut_pct',
    0.05,
    'percentage',
    'Broker Mediation Fee',
    'Additional percentage taken when a Broker Helper mediates the transaction.',
    0.00,
    0.15),

  ('tier2_subscription_cents',
    2900,
    'cents',
    'Pro Subscription Monthly Price',
    'Monthly subscription price for Tier 2 (Pro) helpers in cents. $29.00 = 2900. Changes sync to Stripe.',
    999,
    9999),

  ('tier3_subscription_cents',
    7900,
    'cents',
    'Broker Subscription Monthly Price',
    'Monthly subscription price for Tier 3 (Broker) helpers in cents. $79.00 = 7900. Changes sync to Stripe.',
    2900,
    29900)
  ON CONFLICT (key) DO NOTHING;

-- ——— Fee Change History ———————————————————————————
-- Immutable log of every price change. Never delete.
  CREATE TABLE IF NOT EXISTS fee_change_log (
  id            BIGSERIAL   PRIMARY KEY,
  config_key    VARCHAR(100) NOT NULL,
  old_value     DECIMAL(10,4) NOT NULL,
  new_value     DECIMAL(10,4) NOT NULL,
  changed_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  ip_hash       VARCHAR(64),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

  CREATE INDEX IF NOT EXISTS idx_fee_change_log_key    ON fee_change_log(config_key);
  CREATE INDEX IF NOT EXISTS idx_fee_change_log_created ON fee_change_log(created_at DESC);

-- Prevent deletion of fee history (safe if rule already exists)
DO $$ BEGIN
  CREATE RULE fee_log_no_delete AS ON DELETE TO fee_change_log
  DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;
