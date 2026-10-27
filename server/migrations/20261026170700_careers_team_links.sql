-- OxSteed Careers: links into the existing team tables (careers spec §4.5, §4.6, §9.1).
--
-- business_members.employment_basis  'temporary'/'seasonal' for shift hires (§4.5)
-- business_members.career_offer_id   which accepted offer created the membership
-- staff_offboarding_records.rehire_eligible  the former employer's own call;
--                                     blocks a career rehire and feeds the
--                                     employer-only rehire_eligible fact
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS employment_basis TEXT NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS career_offer_id BIGINT REFERENCES career_offers(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_members_employment_basis_check') THEN
    ALTER TABLE business_members ADD CONSTRAINT business_members_employment_basis_check
      CHECK (employment_basis IN ('regular','temporary','seasonal'));
  END IF;
END $$;

ALTER TABLE staff_offboarding_records
  ADD COLUMN IF NOT EXISTS rehire_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS rehire_note_code TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_offboarding_rehire_note_code_check') THEN
    ALTER TABLE staff_offboarding_records ADD CONSTRAINT staff_offboarding_rehire_note_code_check
      CHECK (rehire_note_code IS NULL OR rehire_note_code IN ('policy_violation','attendance','performance','other'));
  END IF;
END $$;

-- A careers hire's first shift is created as a draft and linked to the run.
ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS career_onboarding_run_id BIGINT REFERENCES career_onboarding_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_staff_shifts_career_run
  ON business_staff_shifts (career_onboarding_run_id) WHERE career_onboarding_run_id IS NOT NULL;

COMMIT;
