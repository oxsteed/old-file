-- OxSteed Invest: full investment domain schema (spec sections 4-9).
--
-- Schema owner note: later tracks build routes, controllers, and UI on
-- these tables. Every financial movement also writes an immutable row to
-- investment_ledger_entries; staff never edit totals directly. Live
-- activity stays disabled behind INVEST_ENABLED /
-- INVEST_COMMITMENTS_ENABLED (both default off) until counsel and partner
-- approval. See docs/oxsteed-invest/schema.md for the table-by-table
-- description and docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md for the
-- settlement model these tables encode.
--
-- Status lifecycles follow spec section 8. "Funded" is the opportunity;
-- "Completed" is one investor's commitment. No status is shared between
-- the opportunity, the commitment, and the distribution lifecycles.

-- ── Opportunities (the entity raise) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  purpose TEXT NOT NULL,
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  minimum_cents BIGINT NOT NULL DEFAULT 0 CHECK (minimum_cents >= 0),
  deadline_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'published', 'paused', 'closing', 'closed', 'cancelled', 'withdrawn')),
  structure VARCHAR(32) NOT NULL DEFAULT 'revenue_share'
    CHECK (structure IN ('revenue_share')),
  country_code CHAR(2) NOT NULL DEFAULT 'US' CHECK (country_code = 'US'),
  valuation_rule TEXT,
  use_of_proceeds TEXT,
  intermediary_ref VARCHAR(160),
  current_agreement_version_id UUID,
  closing_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  closing_conditions_approved_at TIMESTAMPTZ,
  closing_conditions_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  expected_version INTEGER NOT NULL DEFAULT 1 CHECK (expected_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (minimum_cents <= target_cents),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_opportunities_business_status
  ON investment_opportunities(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invest_opportunities_status_deadline
  ON investment_opportunities(status, deadline_at);

-- ── Agreement versions (exact version an investor accepts) ─────────────
CREATE TABLE IF NOT EXISTS investment_agreement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  content_hash VARCHAR(128) NOT NULL,
  body TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_invest_agreement_versions_opportunity
  ON investment_agreement_versions(opportunity_id, version_number DESC);

-- The opportunity points at its current agreement version; the FK is
-- added after both tables exist because the reference is circular.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'investment_opportunities'::regclass
       AND conname = 'investment_opportunities_current_agreement_fk'
  ) THEN
    ALTER TABLE investment_opportunities
      ADD CONSTRAINT investment_opportunities_current_agreement_fk
      FOREIGN KEY (current_agreement_version_id)
      REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ── Participation applications ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_participation_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  authority_verified BOOLEAN NOT NULL DEFAULT FALSE,
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  agreement_version_id UUID REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT,
  agreement_accepted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  expected_version INTEGER NOT NULL DEFAULT 1 CHECK (expected_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'approved' OR (identity_verified AND authority_verified)),
  CHECK (agreement_accepted_at IS NULL OR agreement_version_id IS NOT NULL)
);

-- One live application per investor per opportunity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invest_applications_live
  ON investment_participation_applications(user_id, opportunity_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'approved');
CREATE INDEX IF NOT EXISTS idx_invest_applications_opportunity_status
  ON investment_participation_applications(opportunity_id, status, created_at DESC);

-- ── Commitments (one investor's reservation, then position) ────────────
CREATE TABLE IF NOT EXISTS investment_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  application_id UUID REFERENCES investment_participation_applications(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(32) NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'completed', 'cancelled', 'failed')),
  agreement_version_id UUID NOT NULL REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT,
  agreement_version_number INTEGER NOT NULL CHECK (agreement_version_number >= 1),
  credit_reservation_id UUID REFERENCES oxsteed_credit_reservations(id) ON DELETE RESTRICT,
  journal_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  credit_reference_rate NUMERIC(18, 6),
  eligibility_rechecked_at TIMESTAMPTZ,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  expected_version INTEGER NOT NULL DEFAULT 1 CHECK (expected_version >= 1),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK (status <> 'completed' OR journal_transaction_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_commitments_opportunity_status
  ON investment_commitments(opportunity_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invest_commitments_user_status
  ON investment_commitments(user_id, status, created_at DESC);

-- ── Which lots a commitment reserves (release restores these exactly) ───
CREATE TABLE IF NOT EXISTS investment_commitment_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES investment_commitments(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES oxsteed_credit_balance_lots(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'captured')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commitment_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_invest_commitment_lots_lot
  ON investment_commitment_lots(lot_id, status);

-- ── Positions (completed commitments) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  commitment_id UUID NOT NULL UNIQUE REFERENCES investment_commitments(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  agreement_version_id UUID NOT NULL REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT,
  agreement_version_number INTEGER NOT NULL CHECK (agreement_version_number >= 1),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'exited', 'written_off')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invest_positions_user_status
  ON investment_positions(user_id, status, acquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_invest_positions_opportunity
  ON investment_positions(opportunity_id, status);

-- ── Closing approvals: review and execution are separate authorities ────
-- No single grant authorizes both closing and proceeds release, and no
-- entity representative may approve their own opportunity. The service
-- enforces distinct approvers and that the approver is not the entity
-- representative; the schema pins one row per stage per opportunity.
CREATE TABLE IF NOT EXISTS investment_closing_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE CASCADE,
  stage VARCHAR(20) NOT NULL CHECK (stage IN ('review', 'execution')),
  approver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_invest_closing_approvals_opportunity
  ON investment_closing_approvals(opportunity_id, stage);

-- ── Settlements (partner escrow expectation / proceeds / distributions) ─
-- ASSUMPTION (see docs/oxsteed-invest/SETTLEMENT_ASSUMPTIONS.md A3): the
-- regulated partner holds the corresponding monetary value in escrow from
-- commitment through closing. OxSteed holds no investor funds directly.
-- These rows record the expectation and its confirmation; there is no
-- real partner integration, no fiat movement, and no external call here.
CREATE TABLE IF NOT EXISTS investment_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  commitment_id UUID REFERENCES investment_commitments(id) ON DELETE RESTRICT,
  kind VARCHAR(32) NOT NULL
    CHECK (kind IN ('escrow_expectation', 'proceeds_release', 'distribution')),
  status VARCHAR(40) NOT NULL DEFAULT 'pending_partner_confirmation'
    CHECK (status IN ('pending_partner_confirmation', 'confirmed', 'released', 'cancelled', 'failed')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  credit_reference_rate NUMERIC(18, 6),
  partner_ref VARCHAR(160),
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'released' OR released_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_settlements_opportunity_kind
  ON investment_settlements(opportunity_id, kind, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invest_settlements_commitment
  ON investment_settlements(commitment_id, kind);

-- ── Proceeds (entity side of a closed opportunity) ─────────────────────
CREATE TABLE IF NOT EXISTS investment_proceeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  settlement_id UUID REFERENCES investment_settlements(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'awaiting_release'
    CHECK (status IN ('awaiting_release', 'released', 'cancelled')),
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'released' OR released_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_proceeds_opportunity_status
  ON investment_proceeds(opportunity_id, status);

-- ── Distributions (entity pays through the partner, back as Credit) ────
CREATE TABLE IF NOT EXISTS investment_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  position_id UUID REFERENCES investment_positions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settlement_id UUID REFERENCES investment_settlements(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'credited', 'failed', 'reversed')),
  journal_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  lot_id UUID REFERENCES oxsteed_credit_balance_lots(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'credited' OR journal_transaction_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_distributions_user_status
  ON investment_distributions(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invest_distributions_opportunity
  ON investment_distributions(opportunity_id, status, created_at DESC);

-- ── Amendments (material changes: notice + reconfirmation) ─────────────
CREATE TABLE IF NOT EXISTS investment_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'proposed', 'effective', 'withdrawn', 'rejected')),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_agreement_version_id UUID REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT,
  new_agreement_version_id UUID REFERENCES investment_agreement_versions(id) ON DELETE RESTRICT,
  notice_sent_at TIMESTAMPTZ,
  reconfirmation_deadline_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expected_version INTEGER NOT NULL DEFAULT 1 CHECK (expected_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invest_amendments_opportunity_status
  ON investment_amendments(opportunity_id, status, created_at DESC);

-- ── Q and A, updates, documents ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_opportunity_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  question TEXT NOT NULL,
  answer TEXT,
  answered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invest_questions_opportunity
  ON investment_opportunity_questions(opportunity_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS investment_opportunity_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'overdue')),
  due_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invest_updates_opportunity
  ON investment_opportunity_updates(opportunity_id, status, due_at);

CREATE TABLE IF NOT EXISTS investment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL,
  storage_ref VARCHAR(512) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'committed'
    CHECK (visibility IN ('public', 'applicants', 'committed', 'reviewers')),
  confidential BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invest_documents_opportunity
  ON investment_documents(opportunity_id, visibility, created_at DESC);

-- ── Immutable investment subledger journal ─────────────────────────────
-- Append-only, like oxsteed_credit_transactions. Corrections are new
-- compensating entries (entry_type 'correction' or 'reversal'), never an
-- edit. Staff never edit totals directly: every category total in
-- server/services/invest/investmentSubledger.js is a SUM over this table.
CREATE TABLE IF NOT EXISTS investment_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_type VARCHAR(32) NOT NULL
    CHECK (entry_type IN ('reservation', 'release', 'completion', 'proceeds_awaiting', 'proceeds_released', 'distribution_credit', 'correction', 'reversal')),
  category VARCHAR(40) NOT NULL
    CHECK (category IN ('pending_reservations', 'cancelled_released', 'completed_contributions', 'proceeds_awaiting_release', 'released_proceeds', 'distributions', 'corrections_reversals')),
  opportunity_id UUID REFERENCES investment_opportunities(id) ON DELETE RESTRICT,
  commitment_id UUID REFERENCES investment_commitments(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Signed cents: positive moves value into the category, negative moves
  -- it out (a release is a negative pending_reservations entry plus a
  -- positive cancelled_released entry, never a deletion).
  amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
  reference_type VARCHAR(80),
  reference_id VARCHAR(160),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invest_ledger_opportunity_category
  ON investment_ledger_entries(opportunity_id, category, created_at);
CREATE INDEX IF NOT EXISTS idx_invest_ledger_commitment
  ON investment_ledger_entries(commitment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invest_ledger_user
  ON investment_ledger_entries(user_id, created_at DESC);

-- Immutability guard: journal rows cannot be updated or deleted.
CREATE OR REPLACE FUNCTION investment_ledger_entries_no_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'investment_ledger_entries is append-only'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS investment_ledger_entries_no_update ON investment_ledger_entries;
CREATE TRIGGER investment_ledger_entries_no_update
  BEFORE UPDATE ON investment_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION investment_ledger_entries_no_mutation();

DROP TRIGGER IF EXISTS investment_ledger_entries_no_delete ON investment_ledger_entries;
CREATE TRIGGER investment_ledger_entries_no_delete
  BEFORE DELETE ON investment_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION investment_ledger_entries_no_mutation();
