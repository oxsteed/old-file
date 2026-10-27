-- OxSteed Credit licence readiness, part 3: currency-aware, per-country
-- limits stored as data (readiness review bug 3, §3, §6).
--
-- Before this, every cap was one env value in minor units applied to every
-- currency: the $10,000 balance cap was 10,000 HTG (about US$75) in Haiti.
--
-- credit_limit_rules holds explicit limits per scope:
--   scope 'default'  - applies everywhere; amount in USD minor units unless
--                      currency_code says otherwise
--   scope 'currency' - one currency (scope_code = ISO 4217)
--   scope 'country'  - one country (scope_code = ISO 3166-1 alpha-2)
-- optionally narrowed to one KYC tier. Resolution (most specific wins):
-- country+tier, country, currency+tier, currency, default+tier, default,
-- then the code default (the historical env value, in USD cents).
--
-- A rule in another currency is translated with credit_limit_reference_rates.
-- Those rates size LIMITS only; they never price a conversion. A currency
-- with neither a rule nor a reference rate fails closed. Seeded rates are
-- approximate (October 2026) and must be confirmed by finance.
-- Rule changes go through two-admin approval (pending action
-- 'credit_limit_rule_update').

CREATE TABLE IF NOT EXISTS credit_limit_reference_rates (
  currency_code CHAR(3) PRIMARY KEY CHECK (currency_code ~ '^[A-Z]{3}$'),
  units_per_usd NUMERIC(24, 8) NOT NULL CHECK (units_per_usd > 0),
  source VARCHAR(120) NOT NULL,
  as_of DATE NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO credit_limit_reference_rates (currency_code, units_per_usd, source, as_of) VALUES
  ('USD', 1, 'base', '2026-10-27'),
  ('AED', 3.6725, 'seed-approximate', '2026-10-27'), ('AUD', 1.52, 'seed-approximate', '2026-10-27'),
  ('BRL', 5.40, 'seed-approximate', '2026-10-27'), ('CAD', 1.39, 'seed-approximate', '2026-10-27'),
  ('CHF', 0.80, 'seed-approximate', '2026-10-27'), ('CNY', 7.10, 'seed-approximate', '2026-10-27'),
  ('CZK', 21.0, 'seed-approximate', '2026-10-27'), ('DOP', 63.0, 'seed-approximate', '2026-10-27'),
  ('EGP', 48.0, 'seed-approximate', '2026-10-27'), ('EUR', 0.86, 'seed-approximate', '2026-10-27'),
  ('GBP', 0.75, 'seed-approximate', '2026-10-27'), ('HKD', 7.78, 'seed-approximate', '2026-10-27'),
  ('HTG', 130.65, 'BRH taux de reference (seed)', '2026-10-27'), ('HUF', 335, 'seed-approximate', '2026-10-27'),
  ('ILS', 3.30, 'seed-approximate', '2026-10-27'), ('INR', 88.0, 'seed-approximate', '2026-10-27'),
  ('MAD', 9.20, 'seed-approximate', '2026-10-27'), ('MXN', 18.4, 'seed-approximate', '2026-10-27'),
  ('NGN', 1460, 'seed-approximate', '2026-10-27'), ('NOK', 10.1, 'seed-approximate', '2026-10-27'),
  ('NZD', 1.74, 'seed-approximate', '2026-10-27'), ('PHP', 58.0, 'seed-approximate', '2026-10-27'),
  ('PLN', 3.65, 'seed-approximate', '2026-10-27'), ('RON', 4.37, 'seed-approximate', '2026-10-27'),
  ('SAR', 3.75, 'seed-approximate', '2026-10-27'), ('SEK', 9.50, 'seed-approximate', '2026-10-27'),
  ('SGD', 1.30, 'seed-approximate', '2026-10-27'), ('THB', 32.5, 'seed-approximate', '2026-10-27'),
  ('TRY', 42.0, 'seed-approximate', '2026-10-27'), ('ZAR', 17.3, 'seed-approximate', '2026-10-27'),
  ('BHD', 0.376, 'seed-approximate', '2026-10-27'), ('IQD', 1310, 'seed-approximate', '2026-10-27'),
  ('JOD', 0.709, 'seed-approximate', '2026-10-27'), ('KWD', 0.306, 'seed-approximate', '2026-10-27'),
  ('LYD', 5.45, 'seed-approximate', '2026-10-27'), ('OMR', 0.3845, 'seed-approximate', '2026-10-27'),
  ('TND', 2.95, 'seed-approximate', '2026-10-27'), ('CLP', 950, 'seed-approximate', '2026-10-27'),
  ('ISK', 123, 'seed-approximate', '2026-10-27'), ('JPY', 152, 'seed-approximate', '2026-10-27'),
  ('KRW', 1430, 'seed-approximate', '2026-10-27'), ('PYG', 7100, 'seed-approximate', '2026-10-27'),
  ('UGX', 3450, 'seed-approximate', '2026-10-27'), ('VND', 26300, 'seed-approximate', '2026-10-27'),
  ('VUV', 120, 'seed-approximate', '2026-10-27'), ('XAF', 563, 'seed-approximate', '2026-10-27'),
  ('XOF', 563, 'seed-approximate', '2026-10-27'), ('XPF', 102.6, 'seed-approximate', '2026-10-27'),
  ('KES', 129, 'seed-approximate', '2026-10-27')
ON CONFLICT (currency_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_limit_rules (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(10) NOT NULL CHECK (scope IN ('default', 'currency', 'country')),
  scope_code VARCHAR(3) NOT NULL DEFAULT '*',
  kyc_tier SMALLINT CHECK (kyc_tier IS NULL OR kyc_tier BETWEEN 0 AND 3),
  limit_key VARCHAR(60) NOT NULL CHECK (limit_key ~ '^[a-z0-9_]+$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_limit_rules_scope_code CHECK (
    (scope = 'default' AND scope_code = '*')
    OR (scope = 'currency' AND scope_code ~ '^[A-Z]{3}$')
    OR (scope = 'country' AND scope_code ~ '^[A-Z]{2}$')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_limit_rules_scope
  ON credit_limit_rules (scope, scope_code, COALESCE(kyc_tier, -1), limit_key);

-- Every change is kept: rules are edited in place, history is append-only.
CREATE TABLE IF NOT EXISTS credit_limit_rule_history (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT NOT NULL,
  scope VARCHAR(10) NOT NULL,
  scope_code VARCHAR(3) NOT NULL,
  kyc_tier SMALLINT,
  limit_key VARCHAR(60) NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  pending_action_id UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Money-transmitter structuring threshold: $2,000 in the US (MSB SAR
-- level), and the same USD-equivalent default elsewhere until legal sets
-- each country.
INSERT INTO credit_limit_rules (scope, scope_code, limit_key, amount_minor, currency_code, note) VALUES
  ('default', '*', 'aml_structuring_threshold', 200000, 'USD', 'MSB SAR threshold ($2,000); confirm per country'),
  ('country', 'US', 'aml_structuring_threshold', 200000, 'USD', '31 CFR 1022.320 SAR threshold for MSBs')
ON CONFLICT DO NOTHING;

-- Tiered caps on balance held and on monthly inflow (wages included).
-- Tier 0 = no Credit identity verification, 1 = basic, 2 = full.
INSERT INTO credit_limit_rules (scope, scope_code, kyc_tier, limit_key, amount_minor, currency_code, note) VALUES
  ('default', '*', 0, 'kyc_balance_max', 50000, 'USD', 'Unverified holders: $500 held'),
  ('default', '*', 1, 'kyc_balance_max', 300000, 'USD', 'Tier 1: $3,000 held'),
  ('default', '*', 2, 'kyc_balance_max', 1000000, 'USD', 'Tier 2: $10,000 held'),
  ('default', '*', 0, 'kyc_monthly_inflow_max', 100000, 'USD', 'Unverified holders: $1,000 received per 30 days'),
  ('default', '*', 1, 'kyc_monthly_inflow_max', 500000, 'USD', 'Tier 1: $5,000 received per 30 days'),
  ('default', '*', 2, 'kyc_monthly_inflow_max', 2500000, 'USD', 'Tier 2: $25,000 received per 30 days')
ON CONFLICT DO NOTHING;
