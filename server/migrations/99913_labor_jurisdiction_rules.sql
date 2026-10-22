-- Migration 99913: S-20 native labor-law jurisdiction engine basics.
--
-- A jurisdiction is configured per restaurant location
-- (restaurant_labor_jurisdictions): a jurisdiction code such as 'US-FED',
-- 'US-CA', 'US-NYC' plus the native rule parameters OxSteed enforces
-- itself (overtime thresholds, clopening rest, minor limits, break
-- prompts, predictive-scheduling notice). Vendor rule sets (7shifts,
-- Homebase, Fourth) are intentionally out of scope here; the engine
-- evaluates only these native parameters so the schedule-publish hook
-- can warn without a vendor call.
--
-- Every published schedule batch is kept as an immutable snapshot row
-- (restaurant_schedule_versions): the evidence S-20 asks for. The
-- publish endpoint writes one version per publish action with the
-- evaluated rule warnings attached.
--
-- Additive only. Idempotent.

-- ── Jurisdiction config per location ───────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_labor_jurisdictions (
  id                BIGSERIAL PRIMARY KEY,
  restaurant_id     BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id       BIGINT NOT NULL,
  -- 'US-FED' | 'US-CA' | 'US-NYC' | 'US-SFO' | 'US-SEA' | 'US-CHI' | 'US-OR' | 'CUSTOM'
  jurisdiction_code VARCHAR(16) NOT NULL DEFAULT 'US-FED',
  -- Native rule parameters (NULL = use the jurisdiction preset default).
  weekly_overtime_hours      NUMERIC(5,2),
  daily_overtime_hours       NUMERIC(5,2),
  daily_doubletime_hours     NUMERIC(5,2),
  seventh_day_overtime       BOOLEAN,
  min_rest_between_shifts_hours NUMERIC(5,2),
  meal_break_after_minutes   INTEGER,
  meal_break_duration_minutes INTEGER,
  minor_max_daily_hours      NUMERIC(5,2),
  minor_max_weekly_hours     NUMERIC(5,2),
  minor_latest_end_time      TIME,
  schedule_notice_hours      INTEGER,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT restaurant_labor_jurisdictions_location_fk
    FOREIGN KEY (restaurant_id, location_id)
    REFERENCES restaurant_locations(restaurant_id, id) ON DELETE CASCADE,
  CONSTRAINT restaurant_labor_jurisdictions_code_check
    CHECK (jurisdiction_code IN ('US-FED','US-CA','US-NYC','US-SFO','US-SEA','US-CHI','US-OR','CUSTOM'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_labor_jurisdictions_location
  ON restaurant_labor_jurisdictions (restaurant_id, location_id)
  WHERE is_active;

-- ── Published-schedule evidence versions ───────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_schedule_versions (
  id             BIGSERIAL PRIMARY KEY,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  restaurant_id  BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL,
  location_id    BIGINT,
  published_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Snapshot of every shift this publish action made live.
  shift_ids      BIGINT[] NOT NULL DEFAULT '{}',
  shift_count    INTEGER NOT NULL DEFAULT 0,
  week_start     DATE,
  week_end       DATE,
  -- Rule warnings the engine raised at publish time (JSONB array of
  -- {rule, severity, message, user_id, shift_ids}).
  rule_warnings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_restaurant_schedule_versions_scope
  ON restaurant_schedule_versions (business_id, restaurant_id, published_at DESC);
