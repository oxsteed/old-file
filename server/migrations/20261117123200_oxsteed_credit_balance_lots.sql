-- OxSteed Invest: Credit balance lots (prerequisite ledger work).
--
-- The wallet kept one fungible balance per customer per currency with no
-- record of where any cent came from, so eligibility for investment
-- (purchased settled only at launch; earned settled plus approved when an
-- earned issuance path exists) could not be decided. See
-- docs/oxsteed-invest/credit-origin-verification.md (verdict: CANNOT).
--
-- This migration adds lots alongside the existing journal; it does not
-- change any existing table, balance, or journal row. The append-only
-- journal, hash chain, FOR UPDATE locking, and reserved_cents invariant
-- are untouched. A lot is the unit of origin: every wallet inflow must
-- be taggable to exactly one lot, and a lot keeps its source and
-- restrictions for its whole life, including through reservation release.
--
-- Allocation rule (also in server/services/invest/creditLots.js and
-- docs/oxsteed-invest/schema.md): oldest settled eligible lot first.
-- Unknown source is ineligible by default; never silently reclassified.

CREATE TABLE IF NOT EXISTS oxsteed_credit_balance_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  -- Source of the value in this lot. Earned has no issuance path yet, so
  -- no earned lot can exist until one is built with an approval record.
  -- Distribution is value credited back from an investment distribution;
  -- it is not purchased value and is ineligible for new commitments.
  source VARCHAR(32) NOT NULL
    CHECK (source IN ('purchased', 'earned', 'promotional', 'referral', 'borrowed', 'adjustment', 'distribution', 'unknown')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  remaining_cents BIGINT NOT NULL CHECK (remaining_cents >= 0),
  settled_at TIMESTAMPTZ,
  -- Earned lots require an approval reference; purchased lots record the
  -- top-up they came from instead. Approval references are also used for
  -- dispute resolutions that restore eligibility.
  approval_ref VARCHAR(160),
  -- Disputed value stays in its lot but is encumbered: the encumbered
  -- portion is excluded from eligibility until the dispute resolves.
  dispute_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none', 'encumbered', 'resolved')),
  encumbered_cents BIGINT NOT NULL DEFAULT 0 CHECK (encumbered_cents >= 0),
  originating_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  topup_id UUID REFERENCES oxsteed_credit_topups(id) ON DELETE RESTRICT,
  reference_type VARCHAR(80),
  reference_id VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (remaining_cents <= amount_cents),
  CHECK (encumbered_cents <= remaining_cents),
  CHECK (source <> 'earned' OR approval_ref IS NOT NULL),
  CHECK (source <> 'purchased' OR settled_at IS NOT NULL)
);

-- One lot per originating journal transaction and one lot per top-up: an
-- inflow is tagged exactly once, at the inflow point.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_lots_originating_transaction
  ON oxsteed_credit_balance_lots(originating_transaction_id)
  WHERE originating_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_lots_topup
  ON oxsteed_credit_balance_lots(topup_id)
  WHERE topup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_lots_account_source
  ON oxsteed_credit_balance_lots(account_id, source, settled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_lots_customer_currency
  ON oxsteed_credit_balance_lots(customer_id, currency_code, source);
CREATE INDEX IF NOT EXISTS idx_credit_lots_dispute
  ON oxsteed_credit_balance_lots(customer_id, dispute_status)
  WHERE dispute_status = 'encumbered';

-- Admin attestation path for reclassifying unknown lots. Reclassification
-- is never silent: every change writes an audit row here with the actor
-- and the reason, and the lot keeps its original source in metadata.
CREATE TABLE IF NOT EXISTS oxsteed_credit_lot_reclassifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES oxsteed_credit_balance_lots(id) ON DELETE RESTRICT,
  from_source VARCHAR(32) NOT NULL,
  to_source VARCHAR(32) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  evidence_ref VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_source <> to_source),
  CHECK (to_source <> 'purchased' OR evidence_ref IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_credit_lot_reclassifications_lot
  ON oxsteed_credit_lot_reclassifications(lot_id, created_at DESC);
