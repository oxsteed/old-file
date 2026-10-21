-- Migration 970: restaurant labor policy for overtime and break compliance.
--
-- The time clock already records punches and breaks. This policy makes the
-- payroll report explicit about the rules used to price those hours and to
-- surface missing required breaks, instead of silently treating all hours as
-- straight time.

CREATE TABLE IF NOT EXISTS restaurant_labor_policies (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  overtime_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00
    CHECK (overtime_threshold_hours > 0 AND overtime_threshold_hours <= 168),
  overtime_multiplier_bps INTEGER NOT NULL DEFAULT 15000
    CHECK (overtime_multiplier_bps >= 10000 AND overtime_multiplier_bps <= 50000),
  break_after_minutes INTEGER NOT NULL DEFAULT 360
    CHECK (break_after_minutes > 0 AND break_after_minutes <= 1440),
  break_duration_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (break_duration_minutes >= 0 AND break_duration_minutes <= 240),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

