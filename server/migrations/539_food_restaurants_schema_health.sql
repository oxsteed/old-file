-- Migration 539: food_restaurants schema health (idempotent).
-- Re-asserts columns/indexes/constraints that list enrichment, merchant
-- linking/publish, and discovery/kiosk reads expect. Safe to apply on DBs
-- that already ran 305/318/345/350/351 — every ADD uses IF NOT EXISTS.

-- ── Columns from 318 (brand / hours / verified) ─────────────────────────────
ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS brand_accent_hex VARCHAR(7),
  ADD COLUMN IF NOT EXISTS operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Columns from 321 (ops / tax / pause) ─────────────────────────────────────
ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS delivery_radius_meters INTEGER,
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_fee_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS online_order_pause_reason TEXT;

-- ── Columns from 345/350 (discovery display) ────────────────────────────────
ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_level VARCHAR(16) NOT NULL DEFAULT 'mid',
  ADD COLUMN IF NOT EXISTS estimated_delivery_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

-- ── Columns from 351 (discovery operations) ─────────────────────────────────
-- Canonical name is discovery_status (avoid historical misspellings).
ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_rank INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS discovery_status VARCHAR(24) NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS is_accepting_orders_now BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS temporarily_closed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS minimum_order_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_area_radius_meters INTEGER,
  ADD COLUMN IF NOT EXISTS order_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ordered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

-- ── Constraints (idempotent via pg_constraint name checks) ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_delivery_radius_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_delivery_radius_nonnegative
      CHECK (delivery_radius_meters IS NULL OR delivery_radius_meters >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_tax_rate_bps_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_tax_rate_bps_nonnegative
      CHECK (tax_rate_bps >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_service_fee_bps_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_service_fee_bps_nonnegative
      CHECK (service_fee_bps >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_avg_rating_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_avg_rating_range
      CHECK (avg_rating >= 0 AND avg_rating <= 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_rating_count_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_rating_count_nonnegative
      CHECK (rating_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_price_level_allowed'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_price_level_allowed
      CHECK (price_level IN ('cheap', 'mid', 'expensive'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_delivery_minutes_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_delivery_minutes_range
      CHECK (estimated_delivery_minutes IS NULL OR estimated_delivery_minutes BETWEEN 1 AND 240);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_featured_rank_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_featured_rank_nonnegative
      CHECK (featured_rank >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_discovery_status_allowed'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_discovery_status_allowed
      CHECK (discovery_status IN ('visible', 'hidden', 'waitlist', 'internal_only'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_minimum_order_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_minimum_order_nonnegative
      CHECK (minimum_order_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_delivery_fee_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_delivery_fee_nonnegative
      CHECK (delivery_fee_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_service_area_radius_range'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_service_area_radius_range
      CHECK (service_area_radius_meters IS NULL OR service_area_radius_meters BETWEEN 0 AND 200000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_restaurants_order_count_nonnegative'
  ) THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT food_restaurants_order_count_nonnegative
      CHECK (order_count >= 0);
  END IF;
END $$;

-- Backfill estimated delivery when still null (matches 350 intent).
UPDATE food_restaurants
   SET estimated_delivery_minutes = COALESCE(estimated_delivery_minutes, prep_time_min, 30)
 WHERE estimated_delivery_minutes IS NULL;

-- ── Indexes used by discovery / enrichment lookups ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_food_restaurants_business
  ON food_restaurants(business_id);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_discovery_visibility
  ON food_restaurants(discovery_status, status, is_accepting_orders_now, is_featured, featured_rank);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_discovery_rating
  ON food_restaurants(status, avg_rating DESC, rating_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_dietary_tags
  ON food_restaurants USING GIN (dietary_tags);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_price_level
  ON food_restaurants(price_level);

-- Business↔restaurant linking expects at most one restaurant row per business.
-- Only create the unique index when the table has no duplicate business_id rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM food_restaurants
     GROUP BY business_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE '539: skipping unique business_id index — duplicate food_restaurants.business_id rows present';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'idx_food_restaurants_business_unique'
       AND n.nspname = 'public'
  ) THEN
    CREATE UNIQUE INDEX idx_food_restaurants_business_unique
      ON food_restaurants(business_id);
  END IF;
END $$;
