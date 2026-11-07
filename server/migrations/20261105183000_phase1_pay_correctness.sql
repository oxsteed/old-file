-- Migration 20261105183000: Phase 1 pay correctness, international by default.
--
-- Goal goal_a0fc7c0f0394, Phase 1. Pay rules are jurisdiction-driven
-- through rule tables per country/region, never hardcoded per country in
-- code: California is one row in the jurisdiction table, not the logic.
--
--   - restaurant_locations gains currency_code: currency is a
--     per-location property (NULL = fall back to the restaurant's
--     currency). Amounts stay integer minor units everywhere; the
--     per-currency precision (0 decimals for JPY, 3 for BHD, 2 for
--     most) lives in server/utils/currencyPrecision.js, not in SQL.
--   - restaurant_labor_jurisdictions gains the two premium-rule
--     columns the pay calc reads: predictability_premium_hours and
--     meal_break_premium_hours (NULL = the jurisdiction's preset
--     default; see server/services/laborJurisdictionRules.js).
--     Country/region are NOT duplicated here: the jurisdiction code
--     itself encodes them (e.g. US-CA, GB-UK), and the location row
--     already carries address_country / address_state.
--   - restaurant_location_labor_policies: the labor policy keyed by
--     (restaurant, location) with country_code + region_code on the
--     row. The existing restaurant_labor_policies table stays as the
--     restaurant-level fallback, so existing rows keep working.
--   - business_staff_schedule_changes gains the computed premium
--     amount: premium_hours (hours at the regular rate), premium_cents
--     (NULL when the wage was unknown at change time; priced at
--     report time from the current wage instead), and the currency the
--     cents are in.
--   - restaurant_pay_run_lines gains the new pay-line types so a pay
--     run snapshot carries them: doubletime_hours / wages, meal-break
--     premium cents, predictability premium cents, and
--     unpriced_premium_hours (premium hours with no wage to price
--     them; finalization fails closed while any remain).
--
-- Additive only. Idempotent. Finalized pay runs are untouched: they
-- are immutable snapshots and keep their old lines.

-- ── Currency per location ────────────────────────────────────────────
ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3)
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$');

-- ── Premium rules on the jurisdiction row ────────────────────────────
ALTER TABLE restaurant_labor_jurisdictions
  ADD COLUMN IF NOT EXISTS predictability_premium_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS meal_break_premium_hours NUMERIC(5,2);

-- The code CHECK from migration 99913 only allowed the US presets.
-- Widen it to the international preset set (the rule table's keys are
-- the source of truth; the CHECK just keeps typos out of the table).
-- The constraint is dropped and re-added rather than edited in place:
-- 99913 itself is byte-immutable, so the change lives here.
ALTER TABLE restaurant_labor_jurisdictions
  DROP CONSTRAINT IF EXISTS restaurant_labor_jurisdictions_code_check;
ALTER TABLE restaurant_labor_jurisdictions
  ADD CONSTRAINT restaurant_labor_jurisdictions_code_check
  CHECK (jurisdiction_code IN ('US-FED','US-CA','US-NYC','US-SFO','US-SEA','US-CHI','US-OR','GB-UK','CA-ON','HT','CUSTOM'));

-- ── Labor policy per location (restaurant row stays the fallback) ───
CREATE TABLE IF NOT EXISTS restaurant_location_labor_policies (
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  overtime_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00
    CHECK (overtime_threshold_hours > 0 AND overtime_threshold_hours <= 168),
  overtime_multiplier_bps INTEGER NOT NULL DEFAULT 15000
    CHECK (overtime_multiplier_bps >= 10000 AND overtime_multiplier_bps <= 50000),
  break_after_minutes INTEGER NOT NULL DEFAULT 360
    CHECK (break_after_minutes > 0 AND break_after_minutes <= 1440),
  break_duration_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (break_duration_minutes >= 0 AND break_duration_minutes <= 240),
  country_code VARCHAR(2),
  region_code VARCHAR(80),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, location_id),
  CONSTRAINT restaurant_location_labor_policies_location_fk
    FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE
);

-- ── Computed predictability premium on the schedule-change row ───────
ALTER TABLE business_staff_schedule_changes
  ADD COLUMN IF NOT EXISTS premium_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS premium_cents INTEGER,
  ADD COLUMN IF NOT EXISTS premium_currency_code VARCHAR(3)
    CHECK (premium_currency_code IS NULL OR premium_currency_code ~ '^[A-Z]{3}$');

-- ── New pay-line types on pay-run snapshots ──────────────────────────
ALTER TABLE restaurant_pay_run_lines
  ADD COLUMN IF NOT EXISTS doubletime_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doubletime_wages_cents INTEGER,
  ADD COLUMN IF NOT EXISTS meal_break_premium_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predictability_premium_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpriced_premium_hours NUMERIC(5,2) NOT NULL DEFAULT 0;
