-- Migration 280: add investor as a core self-selectable account mode
--
-- Adds investor mode to users.default_mode and pending_registrations.default_mode
-- constraints so investor accounts can be created via join, admin provisioning,
-- and mode switching.

BEGIN;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_mode_check;

ALTER TABLE users
  ADD CONSTRAINT users_default_mode_check
  CHECK (default_mode IN (
    'customer',
    'investor',
    'helper',
    'logistics',
    'business_owner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only',
    'business_manager',
    'business_representative',
    'business_employee',
    'business_support_agent',
    'admin'
  ));

ALTER TABLE pending_registrations
  DROP CONSTRAINT IF EXISTS pending_registrations_default_mode_check;

ALTER TABLE pending_registrations
  ADD CONSTRAINT pending_registrations_default_mode_check
  CHECK (default_mode IS NULL OR default_mode IN (
    'customer',
    'investor',
    'helper',
    'logistics',
    'business_owner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only'
  ));

COMMIT;
