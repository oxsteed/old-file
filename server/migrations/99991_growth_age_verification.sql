-- D-ENG-06 / D19: provider-agnostic age verification.
--
-- growth_subject_eligibility.adult_confirmed stays the single gate input.
-- These columns record HOW adulthood was established so a revocation,
-- provider change or legal review can find and undo it. No date of birth,
-- document image or provider payload is stored here: only the method, the
-- provider name and an opaque, hashed provider reference.
ALTER TABLE growth_subject_eligibility
  ADD COLUMN IF NOT EXISTS verification_method TEXT,
  ADD COLUMN IF NOT EXISTS verification_provider TEXT,
  ADD COLUMN IF NOT EXISTS attestation_version TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE growth_subject_eligibility
    ADD CONSTRAINT growth_subject_eligibility_method_chk
    CHECK (verification_method IS NULL
           OR verification_method IN ('admin_review', 'provider', 'self_attestation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing rows were set by the audited admin review route.
UPDATE growth_subject_eligibility
   SET verification_method = 'admin_review', verified_at = COALESCE(verified_at, reviewed_at)
 WHERE verification_method IS NULL AND adult_confirmed;

-- Append-only history of every age decision (who/what/when), never the
-- underlying evidence.
CREATE TABLE IF NOT EXISTS growth_age_verification_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('admin_review', 'provider', 'self_attestation', 'revocation', 'backfill')),
  provider TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('adult', 'not_adult', 'unknown', 'revoked')),
  reference_hash CHAR(64),
  attestation_version TEXT,
  actor_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growth_age_verification_events_user_idx
  ON growth_age_verification_events (user_id, created_at DESC);
