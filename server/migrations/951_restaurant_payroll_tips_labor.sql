-- Migration 951: Restaurant payroll, tips and labor data foundation
-- (staff review S-04 / S-15 / S-16 / S-20).
--
-- What this adds:
--   1. Membership-level job role + hourly wage of record on
--      business_members. S-15 found no wage or pay rate anywhere in
--      restaurant code. These columns are the fields of record the
--      payroll export and labor-cost reports read. Invite-time capture
--      of the same fields is S-T1's work (migration 946); the columns
--      are added here with IF NOT EXISTS so either track's migration
--      can land first without conflict.
--   2. restaurant_id on business_staff_shifts. Person-based schedules
--      already exist in the Business Hub model (migration 238: user_id,
--      shift_date, start/end times). Rather than inventing a parallel
--      restaurant schedule table, this extends that model so a shift
--      can be pinned to a specific restaurant; legacy rows stay NULL
--      and still count toward the (single-restaurant) business.
--   3. restaurant_tip_pool_settings: per-restaurant tip pooling and
--      tip-out rules (S-15). Rules are a JSONB array of
--      { target_type: 'role' | 'pool', target_key: <job_role, role only>,
--        percent_bps: <basis points of total tips> }.
--   4. restaurant_declared_cash_tips: declared cash tips attributed to
--      a named staff member (S-15). Card tips live on food_orders and
--      are attributed through the POS shift (metadata.shiftId ->
--      restaurant_pos_shifts.staff_user_id); cash tips have no order
--      record, so declarations are the record of attribution.
--
-- Deliberately NOT here (S-04/S-20): no scheduling rules engine, no
-- availability/swap workflow, no overtime rules and no Fair Workweek /
-- predictive-scheduling compliance tables. The review's direction for
-- those is integrate-first (7shifts/Homebase class vendors); this
-- migration is only the in-house data foundation: employee wage, POS
-- tip attribution, schedules by person, sales and labor by period.

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS job_role VARCHAR(80);
ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS hourly_wage_cents INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_members_hourly_wage_nonneg'
  ) THEN
    ALTER TABLE business_members
      ADD CONSTRAINT business_members_hourly_wage_nonneg
      CHECK (hourly_wage_cents IS NULL OR hourly_wage_cents >= 0);
  END IF;
END $$;

ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bss_restaurant
  ON business_staff_shifts(restaurant_id, shift_date);

CREATE TABLE IF NOT EXISTS restaurant_tip_pool_settings (
  restaurant_id   BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  pooling_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  tip_out_rules   JSONB   NOT NULL DEFAULT '[]'::jsonb,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_declared_cash_tips (
  id            BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  staff_user_id UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_date DATE   NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  declared_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_declared_cash_tips_restaurant_date
  ON restaurant_declared_cash_tips(restaurant_id, business_date);
CREATE INDEX IF NOT EXISTS idx_declared_cash_tips_staff
  ON restaurant_declared_cash_tips(restaurant_id, staff_user_id, business_date);
