-- OxSteed Credit licence readiness, part 7: safeguarding, suspicious
-- activity reports and KYC re-verification.
--
-- Safeguarding: customer and helper funds are held in designated accounts.
-- Every account and every bank-statement balance entry is recorded by one
-- administrator and approved by a different one (DB CHECKs). A daily
-- reconciliation compares ledger liabilities with safeguarded balances per
-- currency and raises a case + incident on any shortfall.
--
-- SAR: drafts are prepared from compliance cases, approved by a second
-- administrator, filed with the financial intelligence unit and tracked
-- against a deadline. Subjects are never notified (no tipping off).
--
-- KYC: re-verification requirements (identity expiry, new payout account
-- after the first, legal-name change, AML case) block cash-out until the
-- customer verifies again or two administrators waive the requirement.

CREATE TABLE IF NOT EXISTS credit_safeguarding_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  account_reference_masked VARCHAR(40) NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  account_kind VARCHAR(30) NOT NULL CHECK (account_kind IN ('segregated_bank', 'trust', 'central_bank', 'insured_deposit')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  acknowledgement_reference TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT credit_safeguarding_account_two_person CHECK (created_by <> approved_by)
);

CREATE TABLE IF NOT EXISTS credit_safeguarding_balance_entries (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES credit_safeguarding_accounts(id),
  as_of_date DATE NOT NULL,
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  statement_reference TEXT NOT NULL,
  evidence_sha256 CHAR(64),
  entered_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_safeguarding_balance_two_person CHECK (entered_by <> approved_by),
  UNIQUE (account_id, as_of_date)
);

CREATE TABLE IF NOT EXISTS credit_safeguarding_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  currency_code CHAR(3) NOT NULL,
  liabilities_minor BIGINT NOT NULL,
  safeguarded_minor BIGINT NOT NULL,
  difference_minor BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ok', 'shortfall', 'excess', 'missing_balance')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_date, currency_code)
);

CREATE TABLE IF NOT EXISTS credit_sar_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('customer', 'partner')),
  subject_id TEXT NOT NULL,
  case_ids UUID[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'filed', 'withdrawn')),
  regulator VARCHAR(40) NOT NULL DEFAULT 'UCREF',
  narrative TEXT NOT NULL DEFAULT '',
  activity_from DATE,
  activity_to DATE,
  amount_minor BIGINT,
  currency_code CHAR(3),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  prepared_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),
  filed_at TIMESTAMPTZ,
  filing_reference TEXT,
  withdrawn_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_sar_two_person CHECK (approved_by IS NULL OR approved_by <> prepared_by),
  CONSTRAINT credit_sar_filed_needs_approval CHECK (status <> 'filed' OR (approved_by IS NOT NULL AND filed_at IS NOT NULL AND filing_reference IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_sar_status_due ON credit_sar_reports (status, due_at);

CREATE TABLE IF NOT EXISTS credit_kyc_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger VARCHAR(40) NOT NULL CHECK (trigger IN ('identity_expiry', 'periodic_review', 'new_payout_destination', 'legal_name_change', 'aml_case', 'manual')),
  source_id TEXT,
  required_tier SMALLINT NOT NULL DEFAULT 2 CHECK (required_tier BETWEEN 1 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'satisfied', 'waived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  satisfied_at TIMESTAMPTZ,
  satisfied_by_verification UUID,
  waived_by UUID REFERENCES users(id),
  waive_approved_by UUID REFERENCES users(id),
  waive_reason TEXT,
  notified_at TIMESTAMPTZ,
  CONSTRAINT credit_kyc_waive_two_person CHECK (
    status <> 'waived' OR (waived_by IS NOT NULL AND waive_approved_by IS NOT NULL AND waived_by <> waive_approved_by AND waive_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_kyc_requirement_open
  ON credit_kyc_requirements (user_id, trigger) WHERE status = 'open';

-- Legal-name change of a verified customer opens a re-verification
-- requirement (DB-level so no application path can skip it).
CREATE OR REPLACE FUNCTION credit_kyc_name_change_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name)
     AND EXISTS (SELECT 1 FROM oxsteed_credit_identity_verifications v
                  WHERE v.customer_id = NEW.id AND v.status = 'verified' AND v.tier >= 1) THEN
    INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
    VALUES (NEW.id, 'legal_name_change', NULL, 2)
    ON CONFLICT (user_id, trigger) WHERE status = 'open' DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'credit_kyc_name_change_trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_credit_kyc_name_change ON users;
CREATE TRIGGER trg_credit_kyc_name_change
  AFTER UPDATE OF first_name, last_name ON users
  FOR EACH ROW EXECUTE FUNCTION credit_kyc_name_change_trigger();

-- Platform-level cases (safeguarding shortfalls, audit anchoring failures)
-- have no customer or partner subject.
ALTER TABLE oxsteed_credit_compliance_cases DROP CONSTRAINT IF EXISTS oxsteed_credit_compliance_cases_subject_type_check;
ALTER TABLE oxsteed_credit_compliance_cases
  ADD CONSTRAINT oxsteed_credit_compliance_cases_subject_type_check
  CHECK (subject_type IN ('customer', 'partner', 'platform'));
