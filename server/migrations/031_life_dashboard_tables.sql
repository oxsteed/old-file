-- ═══════════════════════════════════════════════════════════════════════════
-- 030 — Life Dashboard Tables
-- Supports: expense tracking, budgets, goals, saved helpers, home maintenance
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EXPENSES ──────────────────────────────────────────────────────────────
-- Tracks both income and expenses for any user (helper earnings auto-logged later)
CREATE TABLE IF NOT EXISTS expenses (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(10) NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category      VARCHAR(60) NOT NULL,           -- e.g. 'Gas & Transportation', 'Supplies', 'Gig Payment'
  description   VARCHAR(255),
  occurred_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user_type ON expenses (user_id, type);

-- ── BUDGET CATEGORIES ─────────────────────────────────────────────────────
-- User-defined monthly budget limits per category
CREATE TABLE IF NOT EXISTS budget_categories (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      VARCHAR(60) NOT NULL,
  monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit >= 0),
  color         VARCHAR(20) DEFAULT '#F4A261',  -- for UI rendering
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category)
);

-- ── GOALS ─────────────────────────────────────────────────────────────────
-- Financial + life goals with progress tracking
CREATE TABLE IF NOT EXISTS goals (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(120) NOT NULL,
  goal_type     VARCHAR(20) NOT NULL DEFAULT 'financial' CHECK (goal_type IN ('financial', 'task', 'career')),
  target_value  NUMERIC(12,2),                  -- for financial goals (dollar amount)
  current_value NUMERIC(12,2) DEFAULT 0,        -- for financial goals
  is_completed  BOOLEAN NOT NULL DEFAULT false,
  due_date      DATE,
  icon          VARCHAR(10) DEFAULT '🎯',        -- emoji for UI
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id, is_completed);

-- ── SAVED HELPERS ─────────────────────────────────────────────────────────
-- Customers can save/favorite helpers for quick rehiring
CREATE TABLE IF NOT EXISTS saved_helpers (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the customer
  helper_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the helper
  note          VARCHAR(255),                    -- optional personal note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_helpers_user ON saved_helpers (user_id);

-- ── HOME TASKS ────────────────────────────────────────────────────────────
-- Recurring home maintenance reminders + one-off tasks
CREATE TABLE IF NOT EXISTS home_tasks (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  description     VARCHAR(500),
  due_date        DATE,
  recurrence_days INT,                           -- null = one-time, 30 = monthly, 90 = quarterly, etc.
  is_completed    BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  urgency         VARCHAR(10) DEFAULT 'low' CHECK (urgency IN ('low', 'medium', 'high')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_tasks_user ON home_tasks (user_id, is_completed, due_date);

-- ── LIFE CHECKLIST ────────────────────────────────────────────────────────
-- Simple personal to-do / life admin items
CREATE TABLE IF NOT EXISTS checklist_items (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  due_date      DATE,
  is_completed  BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_user ON checklist_items (user_id, is_completed);
