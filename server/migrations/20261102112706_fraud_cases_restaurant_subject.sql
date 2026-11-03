-- Track D (finding 23): fraud cases gain 'restaurant' as a subject type so
-- restaurant fraud has a case home. The CHECK constraint name is the
-- Postgres default from migration 609 (fraud_cases_subject_type_check).
-- Idempotent: dropping a missing constraint is skipped, and the new
-- constraint is only added when the old one is gone.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fraud_cases_subject_type_check'
      AND conrelid = 'fraud_cases'::regclass
  ) THEN
    ALTER TABLE fraud_cases DROP CONSTRAINT fraud_cases_subject_type_check;
  END IF;
END $$;

ALTER TABLE fraud_cases
  ADD CONSTRAINT fraud_cases_subject_type_check
  CHECK (subject_type IN ('user', 'business', 'restaurant'));
