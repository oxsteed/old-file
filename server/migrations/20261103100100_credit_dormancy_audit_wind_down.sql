-- OxSteed Credit licence readiness, part 8: dormancy/escheat (§8), audit
-- and controls (§9) and wind-down/redemption (§10).
--
-- 1. Dormancy policies per country (off until counsel sets them), dormancy
--    cases (notice, due diligence deadline, escheatment to the
--    unclaimed_property liability, reclaim, remittance to the authority).
--    Escheat, reclaim and remittance each need two administrators.
-- 2. Periodic access reviews (admins, permission grants, API keys) with a
--    reviewer who is never the subject; completion needs two admins.
-- 3. Regulator report packs (generated files, hashed, audited).
-- 4. Daily external anchors of the audit and ledger hash-chain heads
--    (emailed through Resend and/or written to R2), chained to each other.
-- 5. Wind-down plans and per-holder redemption tracking.

-- ── Compliance case types used below ───────────────────────────────────
ALTER TABLE oxsteed_credit_compliance_cases
  DROP CONSTRAINT IF EXISTS oxsteed_credit_compliance_cases_case_type_check;
ALTER TABLE oxsteed_credit_compliance_cases
  ADD CONSTRAINT oxsteed_credit_compliance_cases_case_type_check
  CHECK (case_type IN (
    'structuring', 'velocity_spike', 'rapid_fund_out', 'new_destination_payout',
    'sanctions_hit', 'manual',
    'payout_destination_review', 'cashout_review', 'helper_balance_anomaly',
    'cross_border_pattern', 'device_linkage', 'shared_destination', 'large_payout',
    'kyc_reverification', 'safeguarding_shortfall', 'sar_candidate', 'dispute_pattern',
    'access_review_revocation', 'audit_anchor_mismatch', 'dispute_deadline'
  ));

-- ── 1. Dormancy and escheat ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_dormancy_policies (
  country_code CHAR(2) PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  dormant_after_days INTEGER NOT NULL CHECK (dormant_after_days BETWEEN 180 AND 7300),
  notice_period_days INTEGER NOT NULL CHECK (notice_period_days BETWEEN 30 AND 730),
  authority_name VARCHAR(200) NOT NULL,
  legal_reference VARCHAR(300) NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_dormancy_policy_two_person CHECK (requested_by <> approved_by)
);

CREATE TABLE IF NOT EXISTS credit_escheat_remittances (
  id BIGSERIAL PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  authority_name VARCHAR(200) NOT NULL,
  authority_reference VARCHAR(160) NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor > 0),
  case_count INTEGER NOT NULL CHECK (case_count > 0),
  transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_escheat_remittance_two_person CHECK (requested_by <> approved_by)
);

CREATE TABLE IF NOT EXISTS credit_dormancy_cases (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  holder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  account_type VARCHAR(32) NOT NULL CHECK (account_type IN ('customer_wallet', 'partner_payable')),
  partner_id BIGINT,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  last_activity_at TIMESTAMPTZ,
  source VARCHAR(20) NOT NULL DEFAULT 'dormancy' CHECK (source IN ('dormancy', 'erasure', 'wind_down')),
  status VARCHAR(20) NOT NULL DEFAULT 'notified'
    CHECK (status IN ('notified', 'reactivated', 'escheat_due', 'escheated', 'reclaimed', 'remitted', 'closed_zero')),
  notice_sent_at TIMESTAMPTZ,
  notice_result JSONB,
  deadline_at TIMESTAMPTZ,
  escheated_minor BIGINT CHECK (escheated_minor IS NULL OR escheated_minor > 0),
  escheat_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  escheated_at TIMESTAMPTZ,
  reclaim_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  reclaimed_at TIMESTAMPTZ,
  remittance_id BIGINT REFERENCES credit_escheat_remittances(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_dormancy_escheat_evidence CHECK (
    status NOT IN ('escheated', 'reclaimed', 'remitted')
    OR (escheat_transaction_id IS NOT NULL AND escheated_minor IS NOT NULL AND escheated_at IS NOT NULL)
  ),
  CONSTRAINT credit_dormancy_reclaim_evidence CHECK (status <> 'reclaimed' OR reclaim_transaction_id IS NOT NULL),
  CONSTRAINT credit_dormancy_remit_evidence CHECK (status <> 'remitted' OR remittance_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_dormancy_case_open
  ON credit_dormancy_cases (account_id) WHERE status IN ('notified', 'escheat_due', 'escheated');
CREATE INDEX IF NOT EXISTS idx_credit_dormancy_status ON credit_dormancy_cases (status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_credit_dormancy_holder ON credit_dormancy_cases (holder_user_id, created_at DESC);

-- ── 2. Access reviews ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_access_reviews (
  id BIGSERIAL PRIMARY KEY,
  period_label VARCHAR(20) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  due_at TIMESTAMPTZ NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  overdue_flagged_at TIMESTAMPTZ,
  completed_requested_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  completed_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_access_review_completion CHECK (
    status <> 'completed' OR (
      completed_at IS NOT NULL AND completed_requested_by IS NOT NULL AND completed_approved_by IS NOT NULL
      AND completed_requested_by <> completed_approved_by
    )
  )
);

CREATE TABLE IF NOT EXISTS credit_access_review_items (
  id BIGSERIAL PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES credit_access_reviews(id) ON DELETE CASCADE,
  subject_type VARCHAR(30) NOT NULL CHECK (subject_type IN ('admin_role', 'permission_grant', 'api_key')),
  subject_ref VARCHAR(80) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  decision VARCHAR(10) CHECK (decision IS NULL OR decision IN ('keep', 'revoke')),
  note VARCHAR(1000),
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  UNIQUE (review_id, subject_type, subject_ref),
  CONSTRAINT credit_access_review_not_self CHECK (decided_by IS NULL OR decided_by <> user_id),
  CONSTRAINT credit_access_review_decision_evidence CHECK (
    decision IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT credit_access_review_revoke_note CHECK (decision IS DISTINCT FROM 'revoke' OR NULLIF(btrim(note), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_credit_access_review_items_review ON credit_access_review_items (review_id, decision);

-- ── 3. Report packs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_report_packs (
  id BIGSERIAL PRIMARY KEY,
  pack_type VARCHAR(40) NOT NULL CHECK (pack_type IN (
    'msb_call_report', 'safeguarding_attestation', 'complaint_log', 'aml_summary', 'large_transactions', 'dormancy_escheat'
  )),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL,
  files JSONB NOT NULL,
  sha256 CHAR(64) NOT NULL,
  generated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_to >= period_from)
);
CREATE INDEX IF NOT EXISTS idx_credit_report_packs_type ON credit_report_packs (pack_type, generated_at DESC);

-- ── 4. Audit anchors ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_audit_anchors (
  id BIGSERIAL PRIMARY KEY,
  anchor_date DATE NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  previous_anchor_sha256 CHAR(64),
  email_status VARCHAR(20) NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('sent', 'failed', 'skipped')),
  email_provider_id VARCHAR(160),
  r2_status VARCHAR(20) NOT NULL DEFAULT 'skipped' CHECK (r2_status IN ('stored', 'failed', 'skipped')),
  r2_key VARCHAR(300),
  errors JSONB,
  last_verified_at TIMESTAMPTZ,
  last_verification JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION credit_audit_anchor_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit anchors cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.previous_anchor_sha256 IS DISTINCT FROM OLD.previous_anchor_sha256 OR NEW.anchor_date IS DISTINCT FROM OLD.anchor_date THEN
    RAISE EXCEPTION 'Audit anchor payloads are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS credit_audit_anchor_immutable ON credit_audit_anchors;
CREATE TRIGGER credit_audit_anchor_immutable
  BEFORE UPDATE OR DELETE ON credit_audit_anchors
  FOR EACH ROW EXECUTE FUNCTION credit_audit_anchor_immutable();

-- ── 5. Wind-down ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_wind_down_plans (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 4000),
  redemption_deadline DATE NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  holder_count INTEGER NOT NULL DEFAULT 0,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_requested_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  completed_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  -- A plan started in error (or made moot, e.g. the licence was restored)
  -- is cancelled by two administrators with a reason.
  cancel_reason TEXT,
  CONSTRAINT credit_wind_down_cancel_reason CHECK (status <> 'cancelled' OR length(btrim(COALESCE(cancel_reason, ''))) >= 10),
  CONSTRAINT credit_wind_down_two_person CHECK (requested_by <> approved_by),
  CONSTRAINT credit_wind_down_completion CHECK (
    status = 'active' OR (completed_at IS NOT NULL AND completed_requested_by IS NOT NULL
      AND completed_approved_by IS NOT NULL AND completed_requested_by <> completed_approved_by)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_wind_down_active ON credit_wind_down_plans ((TRUE)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS credit_wind_down_holders (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES credit_wind_down_plans(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  account_type VARCHAR(32) NOT NULL CHECK (account_type IN ('customer_wallet', 'partner_payable')),
  holder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  partner_id BIGINT,
  currency_code CHAR(3) NOT NULL,
  snapshot_balance_minor BIGINT NOT NULL CHECK (snapshot_balance_minor >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'notified', 'instructed', 'paid', 'returned', 'unclaimed', 'zero')),
  notice_sent_at TIMESTAMPTZ,
  notice_result JSONB,
  destination_id BIGINT REFERENCES credit_payout_destinations(id) ON DELETE RESTRICT,
  instruction_id BIGINT REFERENCES credit_bank_payout_instructions(id) ON DELETE RESTRICT,
  reservation_id UUID,
  redeemed_minor BIGINT NOT NULL DEFAULT 0 CHECK (redeemed_minor >= 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  journal_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ,
  dormancy_case_id BIGINT REFERENCES credit_dormancy_cases(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, account_id),
  CONSTRAINT credit_wind_down_paid_evidence CHECK (status <> 'paid' OR (journal_transaction_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_credit_wind_down_holders_status ON credit_wind_down_holders (plan_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_wind_down_instruction ON credit_wind_down_holders (instruction_id) WHERE instruction_id IS NOT NULL;
