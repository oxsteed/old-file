-- Migration 341: restaurant-specific account modes
--
-- Adds explicit restaurant operating modes so the iOS restaurant apps can
-- declare the experience a user is entering without reusing generic modes.

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
    'restaurant_customer',
    'restaurant_owner',
    'restaurant_manager',
    'restaurant_staff',
    'restaurant_runner',
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
    'restaurant_customer',
    'restaurant_owner',
    'restaurant_manager',
    'restaurant_staff',
    'restaurant_runner',
    'consultant',
    'tool_owner',
    'franchise_applicant',
    'life_only'
  ));

INSERT INTO mode_platform_approval_policies (mode, requires_approval, auto_approve, gated_actions, application_schema)
VALUES
  ('restaurant_customer', FALSE, TRUE, ARRAY[]::TEXT[], '{}'::jsonb),
  ('restaurant_owner',    FALSE, TRUE, ARRAY[]::TEXT[], '{}'::jsonb),
  ('restaurant_manager',  FALSE, TRUE, ARRAY[]::TEXT[], '{}'::jsonb),
  ('restaurant_staff',    FALSE, TRUE, ARRAY[]::TEXT[], '{}'::jsonb),
  ('restaurant_runner',   FALSE, TRUE, ARRAY[]::TEXT[], '{}'::jsonb)
ON CONFLICT (mode) DO NOTHING;

COMMIT;
