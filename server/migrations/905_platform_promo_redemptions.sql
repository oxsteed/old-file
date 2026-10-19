-- Platform promo codes at checkout (analytics decision 2).
-- Funding follows each surface's existing promo model:
--  * jobs: platform-funded out of the platform fee (P2-6-F09), helper net unchanged;
--  * bookings: no prior model, so platform-funded (the platform collects
--    booking payments itself; the booking keeps its gross value);
--  * food: the existing food checkout already applies platform codes as an
--    order discount the restaurant receives net of, i.e. restaurant-funded.
-- promo_redemptions is the per-checkout ledger; usage limits are enforced
-- against it under a row lock on the code.
ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS per_user_limit INTEGER,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3),
  ADD COLUMN IF NOT EXISTS applicable_surfaces TEXT[];

DO $$ BEGIN
  ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_per_user_limit_check
    CHECK (per_user_limit IS NULL OR per_user_limit > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_currency_code_check
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_surfaces_check
    CHECK (applicable_surfaces IS NULL OR applicable_surfaces <@ ARRAY['job','booking','food']::TEXT[]) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_usage_count_nonnegative
    CHECK (usage_count IS NULL OR usage_count >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGSERIAL PRIMARY KEY,
  discount_code_id BIGINT NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  user_id UUID NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('job', 'booking', 'food')),
  reference_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  gross_cents BIGINT NOT NULL CHECK (gross_cents > 0),
  discount_cents BIGINT NOT NULL CHECK (discount_cents > 0 AND discount_cents <= gross_cents),
  funded_by TEXT NOT NULL CHECK (funded_by IN ('platform', 'restaurant')),
  CHECK ((surface = 'food') = (funded_by = 'restaurant')),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'redeemed', 'reversed')),
  provider_reference TEXT,
  reversal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  CHECK ((status = 'reversed') = (reversed_at IS NOT NULL)),
  CHECK (status <> 'redeemed' OR redeemed_at IS NOT NULL)
);
-- One live redemption per checkout reference.
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_one_live_per_reference
  ON promo_redemptions (surface, reference_id) WHERE status <> 'reversed';
CREATE INDEX IF NOT EXISTS promo_redemptions_code_user
  ON promo_redemptions (discount_code_id, user_id) WHERE status <> 'reversed';
CREATE INDEX IF NOT EXISTS promo_redemptions_created ON promo_redemptions (created_at DESC);
CREATE INDEX IF NOT EXISTS promo_redemptions_provider ON promo_redemptions (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Bookings keep the gross value owed for the booking alongside the charge.
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS promo_discount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_amount_cents INTEGER;
DO $$ BEGIN
  ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_promo_discount_check
    CHECK (promo_discount_cents >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
