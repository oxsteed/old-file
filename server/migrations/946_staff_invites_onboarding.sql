-- Migration 946: Staff membership lifecycle (staff review S-01/S-03/S-10/S-11)
--
--   1. Invite-time capture on business_members: job role + pay rate (S-03)
--      and an invite expiry (S-10, 14 days from invite, backfilled for
--      pending rows that predate the column).
--   2. Restaurant job-role presets catalog (team_job_roles): Cashier,
--      Server, Cook, Shift lead. Each preset maps to a base membership role
--      plus a set of permission codes from team_permissions; inviting with a
--      preset applies those permissions as per-membership allow overrides.
--   3. Offboarding retention (S-11): staff-history foreign keys that pointed
--      at users with ON DELETE CASCADE now use ON DELETE SET NULL (and the
--      NOT NULL columns become nullable) so wage-and-hour, schedule and
--      training records survive an account hard-delete.
--   4. restaurant_pos_shifts gains flagged_for_close_* markers so a removed
--      staff member's still-open cash drawers are surfaced to managers
--      instead of silently staying open (S-11).
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. business_members: job role, pay rate, invite expiry
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS job_role VARCHAR(60);

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS pay_rate_cents INTEGER;

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS pay_rate_period VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'business_members'::regclass
       AND conname = 'business_members_pay_rate_cents_check'
  ) THEN
    ALTER TABLE business_members
      ADD CONSTRAINT business_members_pay_rate_cents_check
      CHECK (pay_rate_cents IS NULL OR pay_rate_cents >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'business_members'::regclass
       AND conname = 'business_members_pay_rate_period_check'
  ) THEN
    ALTER TABLE business_members
      ADD CONSTRAINT business_members_pay_rate_period_check
      CHECK (pay_rate_period IS NULL OR pay_rate_period IN ('hour', 'week', 'month', 'year'));
  END IF;
END $$;

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Existing pending invites get the standard 14-day window from when they
-- were sent; already-handled rows keep NULL (expiry only gates pending).
UPDATE business_members
   SET expires_at = invited_at + INTERVAL '14 days'
 WHERE status = 'pending'
   AND expires_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Job-role presets catalog
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_job_roles (
  id               SERIAL PRIMARY KEY,
  code             VARCHAR(40)  NOT NULL UNIQUE,
  name             VARCHAR(80)  NOT NULL,
  description      TEXT,
  base_role        VARCHAR(30)  NOT NULL DEFAULT 'employee'
                     CHECK (base_role IN ('manager', 'representative', 'employee', 'support_agent')),
  permission_codes TEXT[]       NOT NULL DEFAULT '{}',
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO team_job_roles (code, name, description, base_role, permission_codes, sort_order) VALUES
  ('cashier',    'Cashier',    'Runs the register: takes orders and payments.', 'employee',
   ARRAY['orders.view', 'pos.use', 'display.view'], 10),
  ('server',     'Server',     'Takes table orders and follows them through the kitchen.', 'employee',
   ARRAY['orders.view', 'pos.use', 'kitchen.view', 'display.view'], 20),
  ('cook',       'Cook',       'Works the kitchen queue and advances preparation states.', 'employee',
   ARRAY['orders.view', 'kitchen.view', 'kitchen.update', 'display.view'], 30),
  ('shift_lead', 'Shift lead', 'Runs a shift: orders, POS and displays, without menu or settings access.', 'employee',
   ARRAY['orders.view', 'orders.manage', 'pos.use', 'pos.manage', 'kitchen.view', 'kitchen.update', 'display.view', 'display.manage'], 40)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      base_role = EXCLUDED.base_role,
      permission_codes = EXCLUDED.permission_codes,
      sort_order = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Staff-history retention: CASCADE -> SET NULL on user delete (S-11)
-- ─────────────────────────────────────────────────────────────────────────

-- Training assignments: a completion history must outlive the account.
ALTER TABLE restaurant_training_assignments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE restaurant_training_assignments
  DROP CONSTRAINT IF EXISTS restaurant_training_assignments_user_id_fkey;
ALTER TABLE restaurant_training_assignments
  ADD CONSTRAINT restaurant_training_assignments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Staff PINs: the credential row stays (deactivated on offboarding) instead
-- of vanishing with the account.
ALTER TABLE restaurant_staff_pins
  DROP CONSTRAINT IF EXISTS restaurant_staff_pins_staff_user_id_fkey;
ALTER TABLE restaurant_staff_pins
  ADD CONSTRAINT restaurant_staff_pins_staff_user_id_fkey
  FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Schedules: historical shifts are wage-and-hour records.
ALTER TABLE business_staff_shifts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE business_staff_shifts
  DROP CONSTRAINT IF EXISTS business_staff_shifts_user_id_fkey;
ALTER TABLE business_staff_shifts
  ADD CONSTRAINT business_staff_shifts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Time entries: hours worked must be kept for years (e.g. FLSA in the US).
ALTER TABLE business_time_entries ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE business_time_entries
  DROP CONSTRAINT IF EXISTS business_time_entries_user_id_fkey;
ALTER TABLE business_time_entries
  ADD CONSTRAINT business_time_entries_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. POS drawer close flagging for offboarding (S-11)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE restaurant_pos_shifts
  ADD COLUMN IF NOT EXISTS flagged_for_close_at TIMESTAMPTZ;

ALTER TABLE restaurant_pos_shifts
  ADD COLUMN IF NOT EXISTS flagged_for_close_reason TEXT;

COMMIT;
