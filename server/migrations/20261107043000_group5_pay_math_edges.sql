-- Migration 20261107043000: Group 5 design-review pay-math edges
-- (goal goal_a0fc7c0f0394, findings 32, 38, 47).
--
--   - restaurant_labor_jurisdictions gains workweek_start_day (finding
--     32): 0 = Sunday .. 6 = Saturday, NULL = the jurisdiction
--     preset's default (Sunday). One configurable workweek start per
--     jurisdiction, used by pay, the shift validator, the forecast,
--     copy-week, and the punch-time minor check.
--   - restaurant_labor_jurisdictions gains predictability_premium_tiers
--     (finding 38): the NYC Fair Workweek dollar premiums as a JSON
--     object of minor-unit amounts keyed by change type and notice
--     band (see server/services/laborJurisdictionRules.js for the
--     statutory table). NULL = the jurisdiction's preset rule; an
--     hours-based premium rule (predictability_premium_hours) is
--     untouched. JSONB so a location can override the tier table
--     without a column per tier.
--   - restaurant_labor_policies and
--     restaurant_location_labor_policies gain
--     doubletime_multiplier_bps (finding 47): the double-time rate as
--     basis points, same shape as overtime_multiplier_bps. Default
--     20000 (2x) preserves existing behavior where no value is set.
--
-- Additive only. Idempotent.

-- ── Finding 32: workweek start per jurisdiction ──────────────────────
ALTER TABLE restaurant_labor_jurisdictions
  ADD COLUMN IF NOT EXISTS workweek_start_day INTEGER
    CHECK (workweek_start_day IS NULL OR (workweek_start_day >= 0 AND workweek_start_day <= 6));

-- ── Finding 38: dollar-amount predictability premium tiers ───────────
ALTER TABLE restaurant_labor_jurisdictions
  ADD COLUMN IF NOT EXISTS predictability_premium_tiers JSONB;

-- ── Finding 47: double-time multiplier on the labor policy ───────────
ALTER TABLE restaurant_labor_policies
  ADD COLUMN IF NOT EXISTS doubletime_multiplier_bps INTEGER NOT NULL DEFAULT 20000
    CHECK (doubletime_multiplier_bps >= 10000 AND doubletime_multiplier_bps <= 50000);

ALTER TABLE restaurant_location_labor_policies
  ADD COLUMN IF NOT EXISTS doubletime_multiplier_bps INTEGER NOT NULL DEFAULT 20000
    CHECK (doubletime_multiplier_bps >= 10000 AND doubletime_multiplier_bps <= 50000);
