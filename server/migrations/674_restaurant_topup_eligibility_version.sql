-- Migration 674: optimistic-locking version for restaurant top-up eligibility.
--
-- setEligibilityDecision (server/services/restaurantTopupService.js) previously
-- upserted any target state with no expected-version predicate, so a stale
-- admin approval could reverse a newer suspension and release funds to a
-- suspended restaurant. The version starts at 1 and is incremented on every
-- decision / merchant-apply upsert; the API requires the caller to send the
-- version it rendered and rejects mismatches with 409 (code
-- restaurant_topup_version_conflict), so the admin reviews the latest state
-- before deciding.

ALTER TABLE restaurant_topup_eligibility
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'restaurant_topup_eligibility'::regclass
       AND conname = 'restaurant_topup_eligibility_version_check'
  ) THEN
    ALTER TABLE restaurant_topup_eligibility
      ADD CONSTRAINT restaurant_topup_eligibility_version_check
      CHECK (version >= 1);
  END IF;
END $$;
