-- ═══════════════════════════════════════════════════════════════
-- Migration 168: Helper weekly availability template + date overrides
--
-- Enables the bid-acceptance calendar picker:
--   1. helper_availability  — weekly recurring slots (Mon 9am-5pm, etc.)
--   2. helper_availability_overrides — per-date exceptions (blocked/open)
--   3. Index on helper_id for fast lookup during slot computation
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Weekly availability template
--    day_of_week: 0=Sunday … 6=Saturday
CREATE TABLE IF NOT EXISTS helper_availability (
  id              SERIAL PRIMARY KEY,
  helper_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ha_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_helper_availability_helper
  ON helper_availability (helper_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_helper_availability_unique_slot
  ON helper_availability (helper_id, day_of_week, start_time, end_time);

-- 2. Per-date overrides
--    is_blocked = TRUE  → that date (or time range) is blocked even if weekly template is open
--    is_blocked = FALSE → that date has a special opening even if weekly template is closed
--    When start_time/end_time are NULL and is_blocked=TRUE, the whole day is blocked.
CREATE TABLE IF NOT EXISTS helper_availability_overrides (
  id              SERIAL PRIMARY KEY,
  helper_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  override_date   DATE NOT NULL,
  is_blocked      BOOLEAN NOT NULL DEFAULT TRUE,
  start_time      TIME,      -- NULL = entire day
  end_time        TIME,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_hao_time_order CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time > start_time
  )
);

CREATE INDEX IF NOT EXISTS idx_hao_helper_date
  ON helper_availability_overrides (helper_id, override_date);

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 168
-- ═══════════════════════════════════════════════════════════════
