-- Migration 270: users.default_mode
--
-- Adds a `default_mode` preference to every user so the new unified Join
-- signup (replacing the customer/helper split at the navbar) can record
-- which experience the user wants to land in by default on every sign-in.
--
-- Default mode is a *preference*, not a permission gate. The user is still
-- free to switch modes from the in-app Mode Switcher. Modes that require an
-- external grant (business_manager / representative / employee /
-- support_agent) are accepted as valid values here but are not surfaced in
-- the public signup dropdown — they are written by the existing team/access
-- code flow when a user is granted the role on a business.
--
-- Backfill rule (deterministic, runnable repeatedly):
--   * Anyone who has a row in helper_profiles → 'helper'
--   * Otherwise users.role = 'admin' / 'super_admin' → 'admin'
--   * Otherwise → 'customer'
--
-- The CHECK constraint enumerates every value we currently know about.
-- Adding a new mode in the future is a one-line constraint change.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- users.default_mode
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_mode VARCHAR(40);

-- Backfill (idempotent — only fills NULL rows)
UPDATE users u
   SET default_mode = 'helper'
 WHERE u.default_mode IS NULL
   AND EXISTS (SELECT 1 FROM helper_profiles hp WHERE hp.user_id = u.id);

UPDATE users
   SET default_mode = 'admin'
 WHERE default_mode IS NULL
   AND role IN ('admin', 'super_admin');

UPDATE users
   SET default_mode = 'customer'
 WHERE default_mode IS NULL;

-- Now lock it down with a CHECK + index. We DROP-IF-EXISTS first so the
-- migration is re-runnable.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_mode_check;

ALTER TABLE users
  ADD CONSTRAINT users_default_mode_check
  CHECK (default_mode IN (
    -- Self-selectable on signup
    'customer',
    'helper',
    'business_owner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only',
    -- Granted by another party (business owner via Vortex / invite / support
    -- employer flow) — not in the public dropdown, but legal values for the
    -- mode switcher once granted.
    'business_manager',
    'business_representative',
    'business_employee',
    'business_support_agent',
    -- Admin-only
    'admin'
  ));

CREATE INDEX IF NOT EXISTS idx_users_default_mode
  ON users(default_mode)
  WHERE default_mode IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- pending_registrations.default_mode
--
-- The unified Join flow is multi-step: /auth/register/start →
-- /auth/register/accept-terms → /auth/register/verify-otp. The mode chosen
-- at step 1 has to survive until the user is actually created at step 3,
-- so it lives on pending_registrations alongside the other staged fields.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS default_mode VARCHAR(40);

-- Self-selectable-only constraint for the staging table (no admin / granted
-- modes can come in through the public signup).
ALTER TABLE pending_registrations
  DROP CONSTRAINT IF EXISTS pending_registrations_default_mode_check;

ALTER TABLE pending_registrations
  ADD CONSTRAINT pending_registrations_default_mode_check
  CHECK (default_mode IS NULL OR default_mode IN (
    'customer',
    'helper',
    'business_owner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only'
  ));

COMMIT;
