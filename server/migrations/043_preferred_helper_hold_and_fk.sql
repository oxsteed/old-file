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
