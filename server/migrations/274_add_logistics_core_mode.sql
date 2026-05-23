-- Migration 274: add logistics as a core self-selectable account mode
--
-- Promotes OxSteed Logistics into the unified account-type system backed by
-- users.default_mode and pending_registrations.default_mode.
-- Logistics is a customer-class mode at the RBAC layer.

BEGIN;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_default_mode_check;

ALTER TABLE users
  ADD CONSTRAINT users_default_mode_check
  CHECK (default_mode IN (
    'customer',
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
    'helper',
    'logistics',
    'business_owner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only'
  ));

COMMIT;
