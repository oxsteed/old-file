
-- >>> BEGIN: 041_planned_needs.sql <<<
-- Migration 041: Planned Needs
-- Future job + future funding + future activation system
-- OxSteed v2

CREATE TABLE IF NOT EXISTS planned_needs (
  id                       SERIAL PRIMARY KEY,
  user_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                    VARCHAR(200) NOT NULL,
  description              TEXT,
  category                 VARCHAR(50)  NOT NULL DEFAULT 'other',
  -- 'car_care' | 'personal_care' | 'other'

  status                   VARCHAR(30)  NOT NULL DEFAULT 'planned',
  -- 'planned' | 'funding' | 'activating_soon' | 'published' | 'cancelled' | 'completed' | 'regenerated'

  due_date                 DATE         NOT NULL,
  estimated_cost           NUMERIC(10,2),
  actual_cost              NUMERIC(10,2),               -- filled on completion

  lead_time_days           SMALLINT     NOT NULL DEFAULT 7,  -- days before due_date to auto-publish

  recurrence_type          VARCHAR(20)  NOT NULL DEFAULT 'none',
  -- 'none' | 'fixed' | 'floating'
  -- fixed:    next due_date = completed_at + interval (calendar rhythm)
  -- floating: next due_date = actual completion date + interval

  recurrence_interval_days INTEGER,                     -- e.g. 90 for every 90 days

  published_job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  parent_need_id           INTEGER REFERENCES planned_needs(id) ON DELETE SET NULL,

  reserved_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- manually tracked funding already set aside
  notes                    TEXT,

  cancelled_at             TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  published_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_needs_user    ON planned_needs(user_id);
CREATE INDEX IF NOT EXISTS idx_planned_needs_status  ON planned_needs(status);
CREATE INDEX IF NOT EXISTS idx_planned_needs_due     ON planned_needs(due_date);
CREATE INDEX IF NOT EXISTS idx_planned_needs_sched   ON planned_needs(user_id, status, due_date)
  WHERE status IN ('planned', 'funding', 'activating_soon');

-- updated_at auto-update (reuse set_updated_at() from migration 039 if it exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_planned_needs_updated_at') THEN
    CREATE TRIGGER trg_planned_needs_updated_at
      BEFORE UPDATE ON planned_needs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- >>> END: 041_planned_needs.sql <<<

-- >>> BEGIN: 042_planned_needs_preferred_helper.sql <<<
-- Migration 042: Planned Needs — preferred helper fields
-- Adds: preferred_helper_id, preferred_helper_status, helper_notified_at
-- These support the 72-hour preferred-helper hold before job broadcasts to all.

ALTER TABLE planned_needs
  ADD COLUMN IF NOT EXISTS preferred_helper_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_status VARCHAR(20) DEFAULT NULL,
  -- NULL = no preferred helper | 'pending' | 'accepted' | 'declined' | 'expired'
  ADD COLUMN IF NOT EXISTS helper_notified_at      TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_pref_hold
  ON planned_needs(preferred_helper_status, helper_notified_at)
  WHERE preferred_helper_status = 'pending';

-- >>> END: 042_planned_needs_preferred_helper.sql <<<

-- >>> BEGIN: 043_preferred_helper_hold_and_fk.sql <<<
-- Migration 043: Preferred-helper hold columns on jobs + planned_need_id FK
-- Task 1: Add held_for_helper_id so jobs can be published but held for a specific helper
-- Task 7: Add planned_need_id as proper FK (replaces metadata JSONB approach)
-- Task 8: Add cost_history table for recurring need cost tracking
-- Task 10: Inactive helper check column

-- Task 1: held_for_helper_id on jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS held_for_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_held_for_helper
  ON jobs(held_for_helper_id)
  WHERE held_for_helper_id IS NOT NULL;

-- Task 7: planned_need_id FK on jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS planned_need_id INTEGER REFERENCES planned_needs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_planned_need
  ON jobs(planned_need_id)
  WHERE planned_need_id IS NOT NULL;

-- Task 8: Cost history for recurring needs
CREATE TABLE IF NOT EXISTS planned_need_cost_history (
  id            SERIAL PRIMARY KEY,
  planned_need_id INTEGER NOT NULL REFERENCES planned_needs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actual_cost   NUMERIC(10,2) NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pn_cost_history_need
  ON planned_need_cost_history(planned_need_id);

-- Task 9: Quick-add templates table
CREATE TABLE IF NOT EXISTS planned_need_templates (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  category      VARCHAR(50) NOT NULL DEFAULT 'other',
  default_title VARCHAR(200) NOT NULL,
  default_description TEXT,
  default_estimated_cost NUMERIC(10,2),
  default_recurrence_type VARCHAR(20) DEFAULT 'none',
  default_recurrence_interval_days INTEGER,
  default_lead_time_days SMALLINT DEFAULT 7,
  icon          VARCHAR(50),
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed common templates
INSERT INTO planned_need_templates (name, category, default_title, default_estimated_cost, default_recurrence_type, default_recurrence_interval_days, icon, sort_order)
VALUES
  ('Oil Change', 'car_care', 'Oil Change', 75.00, 'floating', 90, 'oil-can', 1),
  ('Tire Rotation', 'car_care', 'Tire Rotation', 40.00, 'fixed', 180, 'tire', 2),
  ('Brake Inspection', 'car_care', 'Brake Inspection', 150.00, 'fixed', 365, 'brake', 3),
  ('Dentist Visit', 'personal_care', 'Dentist Cleaning', 200.00, 'fixed', 180, 'tooth', 4),
  ('Annual Checkup', 'personal_care', 'Annual Physical', 250.00, 'fixed', 365, 'heart', 5),
  ('Haircut', 'personal_care', 'Haircut', 35.00, 'floating', 30, 'scissors', 6),
  ('HVAC Service', 'other', 'HVAC Maintenance', 150.00, 'fixed', 365, 'thermometer', 7),
  ('Lawn Care', 'other', 'Lawn Mowing', 50.00, 'floating', 14, 'leaf', 8)
ON CONFLICT DO NOTHING;

-- >>> END: 043_preferred_helper_hold_and_fk.sql <<<

-- >>> BEGIN: 044_add_job_scheduling_columns.sql <<<
-- Migration 044: Add scheduling/preference columns to jobs table
-- Supports scheduled_time, recurrence, preferred helper, and private notes
-- OxSteed v2

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS scheduled_time      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS preferred_helper_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS private_notes        TEXT;

-- >>> END: 044_add_job_scheduling_columns.sql <<<

-- >>> BEGIN: 045_home_tasks_section.sql <<<
-- Add section column to home_tasks to support Personal Care and Car Care tabs
ALTER TABLE home_tasks ADD COLUMN IF NOT EXISTS section VARCHAR(50) NOT NULL DEFAULT 'home';
CREATE INDEX IF NOT EXISTS home_tasks_user_section_idx ON home_tasks (user_id, section);

-- >>> END: 045_home_tasks_section.sql <<<

-- >>> BEGIN: 046_support_tickets.sql <<<
-- Migration 046: Support ticket system
-- Replaces email-only support with a full ticket/assignment workflow

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     INTEGER     UNIQUE DEFAULT nextval('support_ticket_number_seq'),
  user_id           UUID        REFERENCES users(id) ON DELETE SET NULL,
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  subject           VARCHAR(500) NOT NULL DEFAULT 'Support Request',
  category          VARCHAR(100) NOT NULL DEFAULT 'general',
  priority          VARCHAR(20)  NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  status            VARCHAR(30)  NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','assigned','in_progress','waiting_user','resolved','closed')),
  source            VARCHAR(30)  NOT NULL DEFAULT 'widget'
                      CHECK (source IN ('widget','escalation','direct','email')),
  assigned_to       UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  sender_name   VARCHAR(255),         -- populated for guest / system messages
  sender_email  VARCHAR(255),
  content       TEXT        NOT NULL,
  is_internal   BOOLEAN     NOT NULL DEFAULT false,   -- admin-only note
  is_from_admin BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id  ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created  ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket  ON support_messages(ticket_id, created_at);

-- >>> END: 046_support_tickets.sql <<<

-- >>> BEGIN: 047_recurring_frequency.sql <<<
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

-- >>> END: 047_recurring_frequency.sql <<<
