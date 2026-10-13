-- Payment layers foundation (spec: oxsteed-payment-layers-spec.md, phase 1).
--
--   * currency_minor_units      per-currency exponent (JPY 0, USD 2, KWD 3)
--   * payment_country_policies  per-country rails, legal/tax gates, fees, caps
--   * jobs.payment_rail         which rail moves the money for this job
--   * jobs/users timezone + ISO country codes
--
-- Everything here is additive. With every launch flag off the application
-- keeps today's US behaviour: the rail is recorded (stripe/offline mirror the
-- existing oxsteed/off_platform choice) but nothing is enforced from it.

DO $$ BEGIN
  CREATE TYPE job_payment_rail AS ENUM ('stripe', 'credit', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS currency_minor_units (
  currency_code CHAR(3) PRIMARY KEY CHECK (currency_code ~ '^[A-Z]{3}$'),
  exponent SMALLINT NOT NULL CHECK (exponent BETWEEN 0 AND 3),
  -- Stripe requires some zero-decimal-in-practice currencies (HUF, TWD, UGX…)
  -- to be sent as multiples of 100 for payouts; recorded for validation.
  stripe_amount_divisor INTEGER NOT NULL DEFAULT 1 CHECK (stripe_amount_divisor > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO currency_minor_units (currency_code, exponent, stripe_amount_divisor) VALUES
  ('USD',2,1),('CAD',2,1),('GBP',2,1),('EUR',2,1),('AUD',2,1),('NZD',2,1),('CHF',2,1),
  ('MXN',2,1),('BRL',2,1),('KES',2,1),('HTG',2,1),('DOP',2,1),('JMD',2,1),('NGN',2,1),
  ('GHS',2,1),('ZAR',2,1),('INR',2,1),('PHP',2,1),('SGD',2,1),('HKD',2,1),('SEK',2,1),
  ('NOK',2,1),('DKK',2,1),('PLN',2,1),('CZK',2,1),('MAD',2,1),('XOF',0,1),('XAF',0,1),
  ('JPY',0,1),('KRW',0,1),('VND',0,1),('CLP',0,1),('PYG',0,1),('RWF',0,1),('UGX',0,100),
  ('HUF',2,100),('TWD',2,100),('ISK',0,1),
  ('KWD',3,10),('BHD',3,10),('OMR',3,10),('JOD',3,10),('TND',3,10)
ON CONFLICT (currency_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_country_policies (
  country_code CHAR(2) PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
  default_currency CHAR(3) NOT NULL REFERENCES currency_minor_units(currency_code),
  -- Launch gate. A country can only be enabled once its tax review is done
  -- (locked decision #13: OxSteed collects no tax, so every launch country
  -- needs a marketplace VAT/GST review first). Enforced by CHECK.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  tax_review_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  tax_review_note TEXT,
  stripe_rail_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_connect_supported BOOLEAN NOT NULL DEFAULT FALSE,
  credit_rail_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Legal clearance that a Credit hold may BE the payment (decision #3);
  -- without it Credit is collateral only.
  credit_payment_legal_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  offline_rail_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Local methods without auth/capture: charge now, hold on platform (#5).
  local_methods_legal_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  local_payment_methods TEXT[] NOT NULL DEFAULT '{}',
  -- Holding customer funds on the platform (charge-now for >5-day jobs, #17).
  platform_hold_legal_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  card_auth_window_days SMALLINT NOT NULL DEFAULT 7 CHECK (card_auth_window_days BETWEEN 1 AND 30),
  -- Fees (#7): basis points + fixed minimum in default_currency minor units.
  platform_fee_bps INTEGER NOT NULL DEFAULT 1000 CHECK (platform_fee_bps BETWEEN 0 AND 5000),
  platform_fee_min_minor BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_min_minor >= 0),
  credit_fee_discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (credit_fee_discount_bps BETWEEN 0 AND 5000),
  -- Card processing cost passed through on tips (#9): bps + fixed minor.
  tip_processing_bps INTEGER NOT NULL DEFAULT 290 CHECK (tip_processing_bps BETWEEN 0 AND 1000),
  tip_processing_fixed_minor BIGINT NOT NULL DEFAULT 30 CHECK (tip_processing_fixed_minor >= 0),
  -- Offline rail (#8, #15): first-job cap for new customers.
  offline_first_job_cap_minor BIGINT CHECK (offline_first_job_cap_minor IS NULL OR offline_first_job_cap_minor > 0),
  -- Credit FX spread (#4b), max 100 bps.
  credit_fx_spread_bps INTEGER NOT NULL DEFAULT 100 CHECK (credit_fx_spread_bps BETWEEN 0 AND 100),
  -- Cash-out (#14): partner name, caps, hold.
  cashout_partner VARCHAR(40),
  cashout_hold_days SMALLINT NOT NULL DEFAULT 7 CHECK (cashout_hold_days BETWEEN 0 AND 60),
  cashout_daily_cap_minor BIGINT CHECK (cashout_daily_cap_minor IS NULL OR cashout_daily_cap_minor > 0),
  cashout_monthly_cap_minor BIGINT CHECK (cashout_monthly_cap_minor IS NULL OR cashout_monthly_cap_minor > 0),
  sms_sender_id VARCHAR(20),
  phone_calling_code VARCHAR(5),
  privacy_regime VARCHAR(20) NOT NULL DEFAULT 'default' CHECK (privacy_regime IN ('default', 'gdpr', 'uk_gdpr')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_country_policy_tax_gate CHECK (NOT enabled OR tax_review_cleared)
);

-- US mirrors today's behaviour (10% platform fee handled by feeCalculator
-- while FEATURE_COUNTRY_FEES is off). Pilot countries (#16) are seeded
-- disabled; legal/tax must flip their gates.
INSERT INTO payment_country_policies
  (country_code, default_currency, enabled, tax_review_cleared, tax_review_note, stripe_rail_enabled,
   stripe_connect_supported, offline_rail_enabled, phone_calling_code, privacy_regime, offline_first_job_cap_minor)
VALUES
  ('US','USD',TRUE, TRUE, 'Existing US operation', TRUE, TRUE, TRUE, '1', 'default', NULL),
  ('CA','CAD',FALSE,FALSE,NULL,FALSE,TRUE,FALSE,'1','default',50000),
  ('GB','GBP',FALSE,FALSE,NULL,FALSE,TRUE,FALSE,'44','uk_gdpr',40000),
  ('IE','EUR',FALSE,FALSE,NULL,FALSE,TRUE,FALSE,'353','gdpr',40000),
  ('HT','HTG',FALSE,FALSE,NULL,FALSE,FALSE,FALSE,'509','default',2000000),
  ('KE','KES',FALSE,FALSE,NULL,FALSE,FALSE,FALSE,'254','default',2000000)
ON CONFLICT (country_code) DO NOTHING;

UPDATE payment_country_policies SET local_payment_methods = ARRAY['mpesa'] WHERE country_code = 'KE' AND cardinality(local_payment_methods) = 0;
UPDATE payment_country_policies SET local_payment_methods = ARRAY['bacs_debit'] WHERE country_code = 'GB' AND cardinality(local_payment_methods) = 0;
UPDATE payment_country_policies SET local_payment_methods = ARRAY['sepa_debit'] WHERE country_code = 'IE' AND cardinality(local_payment_methods) = 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS payment_rail job_payment_rail,
  ADD COLUMN IF NOT EXISTS payment_rail_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_currency CHAR(3),
  ADD COLUMN IF NOT EXISTS location_country_code CHAR(2),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS offline_ack_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE jobs ADD CONSTRAINT jobs_location_country_code_iso CHECK (location_country_code IS NULL OR location_country_code ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE jobs ADD CONSTRAINT jobs_settlement_currency_iso CHECK (settlement_currency IS NULL OR settlement_currency ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rail backfill mirrors the existing choice: escrow/protected → stripe,
-- every other accepted job used direct payment → offline.
UPDATE jobs SET payment_rail = 'stripe'
 WHERE payment_rail IS NULL
   AND (transaction_mode = 'guided_protected' OR COALESCE(metadata, '{}'::jsonb) ? 'creditCollateralHoldId');
UPDATE jobs SET payment_rail = 'offline'
 WHERE payment_rail IS NULL AND assigned_helper_id IS NOT NULL;

UPDATE jobs SET location_country_code = CASE
    WHEN upper(btrim(location_country)) ~ '^[A-Z]{2}$' THEN upper(btrim(location_country))
    WHEN upper(btrim(location_country)) IN ('USA', 'UNITED STATES', 'UNITED STATES OF AMERICA', 'U.S.', 'U.S.A.') THEN 'US'
    WHEN upper(btrim(location_country)) = 'CANADA' THEN 'CA'
    WHEN upper(btrim(location_country)) IN ('UNITED KINGDOM', 'UK', 'GREAT BRITAIN') THEN 'GB'
    WHEN upper(btrim(location_country)) = 'IRELAND' THEN 'IE'
    WHEN upper(btrim(location_country)) IN ('HAITI', 'HAÏTI', 'AYITI') THEN 'HT'
    WHEN upper(btrim(location_country)) = 'KENYA' THEN 'KE'
    ELSE NULL END
 WHERE location_country_code IS NULL AND location_country IS NOT NULL;
UPDATE jobs SET location_country_code = 'GB' WHERE location_country_code = 'UK';

CREATE INDEX IF NOT EXISTS idx_jobs_payment_rail ON jobs (payment_rail) WHERE payment_rail IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_location_country_code ON jobs (location_country_code) WHERE location_country_code IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(20);

-- Mirror decimal columns use the currency exponent instead of a fixed 100
-- for non-2-decimal currencies. Runs after trg_jobs_canonical_fields (name
-- order) and also anchors date-only schedules at 09:00 in the job timezone.
CREATE OR REPLACE FUNCTION oxsteed_currency_exponent(code TEXT) RETURNS SMALLINT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT exponent FROM currency_minor_units WHERE currency_code = upper(code)), 2::smallint)
$$;

CREATE OR REPLACE FUNCTION jobs_timezone_and_minor_units() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ins BOOLEAN := TG_OP = 'INSERT';
  exp SMALLINT;
  scale NUMERIC;
BEGIN
  IF NEW.timezone IS NOT NULL AND NEW.scheduled_precision = 'date' AND NEW.scheduled_start_at IS NOT NULL THEN
    IF NEW.scheduled_start_at = ((NEW.scheduled_start_at AT TIME ZONE 'UTC')::date + TIME '09:00') AT TIME ZONE 'UTC'
       AND (ins OR NEW.scheduled_start_at IS DISTINCT FROM OLD.scheduled_start_at OR NEW.timezone IS DISTINCT FROM OLD.timezone) THEN
      NEW.scheduled_start_at := (((NEW.scheduled_start_at AT TIME ZONE 'UTC')::date) + TIME '09:00') AT TIME ZONE NEW.timezone;
    END IF;
    NEW.scheduled_date := (NEW.scheduled_start_at AT TIME ZONE NEW.timezone)::date;
  END IF;

  exp := oxsteed_currency_exponent(COALESCE(NEW.settlement_currency, NEW.currency_code, 'USD'));
  IF exp <> 2 THEN
    scale := power(10::numeric, exp);
    -- *_cents hold minor units of the job currency. Writers for
    -- non-2-decimal currencies must set *_cents (the decimal columns are
    -- derived mirrors), so only mirror back here.
    NEW.budget_min := NEW.budget_min_cents / scale;
    NEW.budget_max := NEW.budget_max_cents / scale;
    NEW.job_value := NEW.job_value_cents / scale;
    NEW.customer_total := NEW.customer_total_cents / scale;
    NEW.platform_fee := NEW.platform_fee_cents / scale;
    NEW.protection_fee := NEW.protection_fee_cents / scale;
    NEW.broker_fee := NEW.broker_fee_cents / scale;
    NEW.helper_payout := NEW.helper_payout_cents / scale;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_timezone_and_minor_units ON jobs;
CREATE TRIGGER trg_jobs_timezone_and_minor_units
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_timezone_and_minor_units();
