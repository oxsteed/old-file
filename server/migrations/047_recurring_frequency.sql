-- ═══════════════════════════════════════════════════════════════════════════
-- 047 — Recurring frequency support
-- Adds frequency + recurring fields to expenses, home_tasks, budget_categories
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXPENSES ──────────────────────────────────────────────────────────────
-- frequency: how often this income/expense occurs
-- is_recurring: true = this is a repeating entry (drives monthly normalization)
-- recurring_start_date / recurring_end_date: optional active range for the pattern
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS frequency            VARCHAR(20)  DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS is_recurring         BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_start_date DATE,
  ADD COLUMN IF NOT EXISTS recurring_end_date   DATE;

-- Constraint to keep frequency values tidy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_frequency_check'
  ) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_frequency_check
      CHECK (frequency IN ('one_time','daily','weekly','bi_weekly','monthly','quarterly','yearly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_recurring ON expenses (user_id, is_recurring)
  WHERE is_recurring = true;

-- ── HOME TASKS (personal_care + car_care) ──────────────────────────────────
-- frequency: named interval instead of raw recurrence_days
-- is_recurring: explicit boolean flag
-- estimated_cost: optional cost per occurrence for financial planning / Life Pulse
-- recurring_start_date / recurring_end_date: optional active range
ALTER TABLE home_tasks
  ADD COLUMN IF NOT EXISTS frequency            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_recurring         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_cost       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS recurring_start_date DATE,
  ADD COLUMN IF NOT EXISTS recurring_end_date   DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'home_tasks_frequency_check'
  ) THEN
    ALTER TABLE home_tasks ADD CONSTRAINT home_tasks_frequency_check
      CHECK (frequency IS NULL OR frequency IN ('one_time','daily','weekly','bi_weekly','monthly','quarterly','yearly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_home_tasks_recurring ON home_tasks (user_id, section, is_recurring)
  WHERE is_recurring = true;

-- ── BUDGET CATEGORIES ─────────────────────────────────────────────────────
-- period: the interval the user's budget amount is expressed in.
-- monthly_limit always stores the MONTHLY-NORMALISED value so all
-- existing queries that compare spending against monthly_limit stay correct.
ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS period VARCHAR(20) NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_categories_period_check'
  ) THEN
    ALTER TABLE budget_categories ADD CONSTRAINT budget_categories_period_check
      CHECK (period IN ('daily','weekly','bi_weekly','monthly','quarterly','yearly'));
  END IF;
END $$;
