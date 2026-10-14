BEGIN;

-- 844: P2-7-F01 one-time truthfulness correction for users.onboarding_completed.
--
-- Mode switches used to set onboarding_completed=TRUE blindly, so customers
-- who self-selected helper mode kept the customer-era TRUE flag and could
-- bid/accept work with zero identity verification. modeRole.applyModeSwitch
-- now re-derives the flag from DB facts on every switch into a helper-class
-- mode; this migration aligns rows written before that fix.
--
-- The completeness bar matches finalizeRegistration and
-- services/helperOnboarding.deriveHelperOnboarding: verified email, recorded
-- terms, completed profile/contact, and verified identity (any of the three
-- identity columns, which writers keep in sync per P2-7-F11).
--
-- Helpers whose facts are complete keep onboarding_completed=TRUE.
-- Everyone else drops to FALSE with status 'verified_pending_onboarding' so
-- the onboarding checklist picks them up. Customer rows are untouched.

UPDATE users
SET onboarding_completed = FALSE,
    onboarding_status    = 'verified_pending_onboarding',
    updated_at           = NOW()
WHERE role IN ('helper', 'helper_pro', 'broker')
  AND onboarding_completed = TRUE
  AND NOT (
    email_verified
    AND profile_completed AND contact_completed
    AND terms_accepted
    AND terms_accepted_at IS NOT NULL
    AND terms_version IS NOT NULL
    AND (id_verified OR identity_verified OR LOWER(didit_status) = 'verified')
  );

COMMIT;
