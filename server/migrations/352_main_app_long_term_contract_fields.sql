-- Migration 352: Long-term production contract fields for OxSteed Main.
--
-- Additive only. These fields give the main app stable cents/currency, payout,
-- permissions, trust, and translation metadata without removing legacy columns.

ALTER TABLE jobs
  -- Keep legacy decimal money columns present because older controllers and
  -- admin/reporting queries still use them as fallbacks while the mobile app
  -- moves to durable cents-based fields.
  ADD COLUMN IF NOT EXISTS budget_min NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS budget_max NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS final_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS job_value NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS customer_total NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS helper_payout NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS protection_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS broker_fee NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS budget_min_cents INTEGER,
  ADD COLUMN IF NOT EXISTS budget_max_cents INTEGER,
  ADD COLUMN IF NOT EXISTS final_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS job_value_cents INTEGER,
  ADD COLUMN IF NOT EXISTS customer_total_cents INTEGER,
  ADD COLUMN IF NOT EXISTS helper_payout_cents INTEGER,
  ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS protection_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS broker_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS payout_status VARCHAR(24) NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS payout_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE jobs
   SET budget_min_cents = COALESCE(budget_min_cents, ROUND(budget_min * 100)::int),
       budget_max_cents = COALESCE(budget_max_cents, ROUND(budget_max * 100)::int),
       final_price_cents = COALESCE(final_price_cents, ROUND(final_price * 100)::int),
       job_value_cents = COALESCE(job_value_cents, ROUND(job_value * 100)::int),
       customer_total_cents = COALESCE(customer_total_cents, ROUND(customer_total * 100)::int),
       helper_payout_cents = COALESCE(helper_payout_cents, ROUND(helper_payout * 100)::int),
       platform_fee_cents = COALESCE(platform_fee_cents, ROUND(platform_fee * 100)::int),
       protection_fee_cents = COALESCE(protection_fee_cents, ROUND(protection_fee * 100)::int),
       broker_fee_cents = COALESCE(broker_fee_cents, ROUND(broker_fee * 100)::int),
       payout_status = CASE
         WHEN status = 'completed' AND paid_at IS NOT NULL THEN 'paid'
         WHEN status = 'completed' THEN 'earned'
         ELSE payout_status
       END
 WHERE budget_min_cents IS NULL
    OR budget_max_cents IS NULL
    OR final_price_cents IS NULL
    OR job_value_cents IS NULL
    OR customer_total_cents IS NULL
    OR helper_payout_cents IS NULL
    OR platform_fee_cents IS NULL
    OR protection_fee_cents IS NULL
    OR broker_fee_cents IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_currency_code_iso4217') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_currency_code_iso4217
      CHECK (currency_code ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_money_cents_nonnegative') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_money_cents_nonnegative
      CHECK (
        (budget_min_cents IS NULL OR budget_min_cents >= 0) AND
        (budget_max_cents IS NULL OR budget_max_cents >= 0) AND
        (final_price_cents IS NULL OR final_price_cents >= 0) AND
        (job_value_cents IS NULL OR job_value_cents >= 0) AND
        (customer_total_cents IS NULL OR customer_total_cents >= 0) AND
        (helper_payout_cents IS NULL OR helper_payout_cents >= 0) AND
        (platform_fee_cents IS NULL OR platform_fee_cents >= 0) AND
        (protection_fee_cents IS NULL OR protection_fee_cents >= 0) AND
        (broker_fee_cents IS NULL OR broker_fee_cents >= 0)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_payout_status_check') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_payout_status_check
      CHECK (payout_status IN ('not_ready','earned','pending','processing','paid','failed','reversed','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_helper_payout_status
  ON jobs(assigned_helper_id, payout_status, completed_at DESC)
  WHERE assigned_helper_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_currency_status
  ON jobs(currency_code, status, created_at DESC);

ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;

UPDATE bids b
   SET amount_cents = COALESCE(b.amount_cents, ROUND(b.amount * 100)::int),
       currency_code = COALESCE(NULLIF(b.currency_code, ''), j.currency_code, 'USD')
  FROM jobs j
 WHERE j.id = b.job_id
   AND (b.amount_cents IS NULL OR b.currency_code IS NULL OR b.currency_code = '');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bids_currency_code_iso4217') THEN
    ALTER TABLE bids
      ADD CONSTRAINT bids_currency_code_iso4217
      CHECK (currency_code ~ '^[A-Z]{3}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bids_amount_cents_nonnegative') THEN
    ALTER TABLE bids
      ADD CONSTRAINT bids_amount_cents_nonnegative
      CHECK (amount_cents IS NULL OR amount_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bids_currency_status
  ON bids(currency_code, status, created_at DESC);

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS rating_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_badges TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS service_area_radius_miles INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'helper_profiles_response_time_nonnegative') THEN
    ALTER TABLE helper_profiles
      ADD CONSTRAINT helper_profiles_response_time_nonnegative
      CHECK (response_time_minutes IS NULL OR response_time_minutes >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'helper_profiles_service_area_radius_range') THEN
    ALTER TABLE helper_profiles
      ADD CONSTRAINT helper_profiles_service_area_radius_range
      CHECK (service_area_radius_miles IS NULL OR service_area_radius_miles BETWEEN 0 AND 500);
  END IF;
END $$;

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source_language VARCHAR(16),
  ADD COLUMN IF NOT EXISTS detected_language VARCHAR(16),
  ADD COLUMN IF NOT EXISTS translation_cache_key TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_translation_cache
  ON messages(translation_cache_key)
  WHERE translation_cache_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_source_language
  ON messages(source_language, created_at DESC)
  WHERE source_language IS NOT NULL;
