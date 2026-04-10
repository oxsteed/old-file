BEGIN;

-- pending_registrations is created in migration 018; on a fresh database this
-- migration runs first (alphabetical sort), so we guard with an existence check.
-- Migration 029 handles user_id/account_created with the correct UUID type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pending_registrations'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'pending_registrations' AND column_name = 'user_id'
    ) THEN
      ALTER TABLE pending_registrations ADD COLUMN user_id INTEGER;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'pending_registrations' AND column_name = 'account_created'
    ) THEN
      ALTER TABLE pending_registrations ADD COLUMN account_created BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'pending_registrations_user_id_fkey'
        AND table_name = 'pending_registrations'
    ) THEN
      ALTER TABLE pending_registrations
        ADD CONSTRAINT pending_registrations_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'verified_pending_onboarding',
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier_selected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS w9_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'tier1',
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS background_check_passed BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_onboarding_status_check'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_onboarding_status_check
      CHECK (
        onboarding_status IN (
          'verified_pending_onboarding',
          'onboarding_in_progress',
          'onboarding_complete',
          'suspended'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_membership_tier_check'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_membership_tier_check
      CHECK (membership_tier IN ('tier1', 'tier2'));
  END IF;
END $$;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS transaction_mode TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS tier3_requested_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier3_accepted_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimate_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimate_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scope_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scope_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiver_acknowledged_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS waiver_acknowledged_by_helper BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS best_practice_warning_shown BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_transaction_mode_check'
      AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_transaction_mode_check
      CHECK (transaction_mode IN ('direct', 'guided_protected'));
  END IF;
END $$;

UPDATE users
SET
  contact_completed  = COALESCE(contact_completed,  FALSE),
  profile_completed  = COALESCE(profile_completed,  FALSE),
  tier_selected      = COALESCE(tier_selected,       FALSE),
  w9_completed       = COALESCE(w9_completed,        FALSE),
  terms_accepted     = COALESCE(terms_accepted,      FALSE),
  onboarding_completed = (
    COALESCE(profile_completed, FALSE)
    AND COALESCE(tier_selected,  FALSE)
    AND COALESCE(w9_completed,   FALSE)
    AND COALESCE(terms_accepted, FALSE)
  ),
  onboarding_status = CASE
    WHEN (
      COALESCE(profile_completed, FALSE)
      AND COALESCE(tier_selected,  FALSE)
      AND COALESCE(w9_completed,   FALSE)
      AND COALESCE(terms_accepted, FALSE)
    ) THEN 'onboarding_complete'
    ELSE 'verified_pending_onboarding'
  END
WHERE role = 'helper';

COMMIT;
