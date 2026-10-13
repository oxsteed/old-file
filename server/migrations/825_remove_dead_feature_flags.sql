-- Migration 825: remove dead / contradictory feature flags and settings.
--
-- P3-7-F05: the seeded feature_flags keys below have no runtime readers
-- (the only key read at runtime is 'oxsteed_credit_enabled', via the
-- OxSteed Credit rail service). Several contradict each other
-- ('referral_system_enabled' = true vs 'referral_program' = false;
-- 'tier3_payments_enabled' = true vs 'escrow_payments' = true, two names for
-- the same idea). Admin-editable flags that do nothing are worse than no
-- flags: flipping them gives a false sense of control. Delete them,
-- keeping only the live credit-rail flag.
--
-- P3-7-F07: platform_settings 'require_id_verification' ("Require ID
-- verification for all helpers") is redundant: helper ID verification is
-- already unconditionally required by finalizeRegistration
-- (id_verified OR identity_verified OR didit_status = 'verified'),
-- by listing eligibility, and by the Tier-3 helper gate. A toggle that
-- cannot change behavior is removed instead of wired.
-- 'maintenance_mode' and 'new_user_registrations' are kept: they now have
-- real runtime readers (maintenance gate middleware, registration gates).

DELETE FROM feature_flags WHERE key IN (
  'tier3_payments_enabled',
  'background_checks_enabled',
  'referral_system_enabled',
  'broker_mediation_enabled',
  'urgent_push_enabled',
  'new_market_signups_enabled',
  'maintenance_mode',
  'escrow_payments',
  'broker_matching',
  'push_notifications',
  'two_factor_auth',
  'helper_background_checks',
  'job_auto_assign',
  'referral_program',
  'multi_language',
  'stripe_identity',
  'waitlist_mode',
  'tool_rental',
  'broker_flow',
  'recurring_jobs',
  'instant_book',
  'id_verification',
  'background_checks',
  'mobile_app'
);

DELETE FROM platform_settings WHERE key = 'require_id_verification';
