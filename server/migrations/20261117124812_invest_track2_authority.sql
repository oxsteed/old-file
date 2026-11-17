-- OxSteed Invest Track 2: authority-matrix columns the Track 1 schema did
-- not carry. Live activity stays disabled behind INVEST_ENABLED /
-- INVEST_COMMITMENTS_ENABLED (both default off) until counsel and partner
-- approval. See docs/oxsteed-invest/schema.md (Track 2 note) and
-- docs/oxsteed-invest/api.md.
--
-- 1. investment_opportunities.details: the entity fundraising submission
-- carries legal details, financials, ownership, risks, and related parties
-- (build brief scope, entity "Raise capital"). Track 1 stored only title,
-- purpose, target, valuation rule, and use of proceeds, so there was nowhere
-- to keep the rest of the submission. Structured JSONB, validated
-- server-side; never a free-form dump.
-- 2. investment_opportunities.verification_summary / verified_at /
-- verified_by: the opportunity detail page carries a verification badge
-- whose text describes what was verified and never implies a guarantee.
-- The badge needs a stored record of what a reviewer actually verified at
-- approval time; without it the badge could only ever say "not verified".
-- 3. investment_opportunities.published_at: the directory sorts neutrally by
-- publication date (or closing date). Track 1 recorded no publication time.
-- 4. investment_participation_applications status 'needs_information': the
-- specified application lifecycle is draft / submitted / in review / needs
-- information / approved / declined / withdrawn. Track 1 stored 'rejected'
-- for declined (kept: the service and tests use it; the API presents it as
-- declined) but had no needs_information state, so a reviewer could not
-- send an application back for more information without declining it.

ALTER TABLE investment_opportunities
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- The applications status CHECK was created inline by migration
-- 20261117123300, so Postgres named it
-- investment_participation_applications_status_check. Replace it with the
-- same list plus needs_information.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'investment_participation_applications'::regclass
       AND conname = 'investment_participation_applications_status_check'
  ) THEN
    ALTER TABLE investment_participation_applications
      DROP CONSTRAINT investment_participation_applications_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'investment_participation_applications'::regclass
       AND conname = 'investment_participation_applications_status_check'
  ) THEN
    ALTER TABLE investment_participation_applications
      ADD CONSTRAINT investment_participation_applications_status_check
      CHECK (status IN ('draft', 'submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'withdrawn'));
  END IF;
END $$;
