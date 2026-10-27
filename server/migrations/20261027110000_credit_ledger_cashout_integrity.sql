-- OxSteed Credit licence readiness, part 1: ledger directions and helper
-- cash-out integrity (readiness review bugs 1, 2, 10 and §8 escheat legs).
--
-- 1. credit_cashout_requests.journal_transaction_id was BIGINT while the
--    journal id is a UUID. Recording a paid cash-out therefore failed AFTER
--    the partner had paid, rolled the ledger posting back and left the row
--    re-submittable (double payout). The column becomes UUID. No valid
--    BIGINT value can exist (every write failed), but any stray value is
--    preserved in legacy_journal_transaction_ref rather than dropped.
-- 2. Cash-out rows gain a request-time reservation, a stable partner
--    idempotency key, a submission lease and a 'submitting' state so a
--    partner call can never be made twice for one request.
-- 3. The journal direction guard learns the helper legs it was missing:
--    cash_out from a helper's partner_payable, the job-payment platform
--    'fee' leg, and the unclaimed-property (escheat) legs.
-- 4. Helper wage balances (partner_payable accounts of helper
--    participants) may never go negative.

-- ── 1. Journal id type ──────────────────────────────────────────────────
ALTER TABLE credit_cashout_requests
  ADD COLUMN IF NOT EXISTS legacy_journal_transaction_ref BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'credit_cashout_requests'
       AND column_name = 'journal_transaction_id'
       AND data_type = 'bigint'
  ) THEN
    UPDATE credit_cashout_requests
       SET legacy_journal_transaction_ref = journal_transaction_id
     WHERE journal_transaction_id IS NOT NULL;
    ALTER TABLE credit_cashout_requests
      ALTER COLUMN journal_transaction_id TYPE UUID USING NULL;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE credit_cashout_requests
    ADD CONSTRAINT credit_cashout_requests_journal_fk
    FOREIGN KEY (journal_transaction_id) REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Reservation, idempotency, lease ──────────────────────────────────
ALTER TABLE credit_cashout_requests
  ADD COLUMN IF NOT EXISTS reservation_id UUID,
  ADD COLUMN IF NOT EXISTS partner_idempotency_key VARCHAR(200),
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submit_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64),
  ADD COLUMN IF NOT EXISTS destination_id BIGINT,
  ADD COLUMN IF NOT EXISTS kyc_tier SMALLINT,
  ADD COLUMN IF NOT EXISTS review_reason VARCHAR(80),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

UPDATE credit_cashout_requests
   SET partner_idempotency_key = 'oxsteed-cashout:' || id::text
 WHERE partner_idempotency_key IS NULL;
ALTER TABLE credit_cashout_requests ALTER COLUMN partner_idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_cashout_partner_idempotency
  ON credit_cashout_requests (partner_idempotency_key);

ALTER TABLE credit_cashout_requests DROP CONSTRAINT IF EXISTS credit_cashout_requests_status_check;
ALTER TABLE credit_cashout_requests ADD CONSTRAINT credit_cashout_requests_status_check
  CHECK (status IN ('requested', 'held_for_review', 'submitting', 'submitted', 'paid', 'failed', 'canceled', 'rejected'));

-- A paid row always carries its journal posting; a submitting row always
-- carries a live lease.
DO $$ BEGIN
  ALTER TABLE credit_cashout_requests ADD CONSTRAINT credit_cashout_paid_has_journal
    CHECK (status <> 'paid' OR journal_transaction_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE credit_cashout_requests ADD CONSTRAINT credit_cashout_submitting_has_lease
    CHECK (status <> 'submitting' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS idx_credit_cashout_due;
CREATE INDEX IF NOT EXISTS idx_credit_cashout_due
  ON credit_cashout_requests (available_at)
  WHERE status IN ('requested', 'submitting', 'submitted');

-- ── 3. Unclaimed property account type (escheat, §8) ────────────────────
ALTER TABLE oxsteed_credit_accounts DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_account_type_check;
ALTER TABLE oxsteed_credit_accounts ADD CONSTRAINT oxsteed_credit_accounts_account_type_check
  CHECK (account_type IN (
    'customer_wallet', 'partner_payable', 'partner_reserve', 'platform_treasury',
    'platform_revenue', 'restaurant_sub_bank', 'unclaimed_property'
  ));
ALTER TABLE oxsteed_credit_accounts DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_owner_check;
ALTER TABLE oxsteed_credit_accounts ADD CONSTRAINT oxsteed_credit_accounts_owner_check
  CHECK (
    (account_type = 'customer_wallet' AND customer_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (account_type IN ('partner_payable', 'partner_reserve') AND customer_id IS NULL AND partner_id IS NOT NULL AND restaurant_id IS NULL)
    OR (account_type IN ('platform_treasury', 'platform_revenue', 'unclaimed_property') AND customer_id IS NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (account_type = 'restaurant_sub_bank' AND restaurant_id IS NOT NULL AND customer_id IS NULL AND partner_id IS NULL)
  );
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_unclaimed_property_account
  ON oxsteed_credit_accounts (account_type, currency_code)
  WHERE account_type = 'unclaimed_property';

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;
ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'media_creator_settlement', 'settlement_reversal', 'fee', 'expiration',
    'chargeback', 'funding', 'reserve_release', 'conversion_debit',
    'conversion_fee', 'conversion_credit', 'cash_out', 'sub_bank_load',
    'sub_bank_redemption', 'sub_bank_refund', 'sub_bank_opening_balance',
    'withdrawal_fee', 'transfer_fee', 'sub_bank_conversion', 'sub_bank_payout',
    'sub_bank_payout_reversal', 'sub_bank_load_reversal',
    'escheatment', 'escheat_reclaim', 'escheat_remittance'
  ));

-- ── 4. Direction guard (migration 859 + helper and escheat legs) ────────
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_types()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_type VARCHAR(32);
  credit_type VARCHAR(32);
  debit_restaurant_id BIGINT;
  credit_restaurant_id BIGINT;
  debit_partner_id BIGINT;
  credit_partner_id BIGINT;
  linked_partner_restaurant_id BIGINT;
  expected_direction_valid BOOLEAN := TRUE;
BEGIN
  SELECT account_type, partner_id INTO debit_type, debit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
  SELECT account_type, partner_id INTO credit_type, credit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type = 'load' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'purchase' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'partner_payable';
  ELSIF NEW.transaction_type = 'refund' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'customer_wallet';
  ELSIF NEW.transaction_type = 'transfer' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'settlement' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'settlement_reversal' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'cash_out' THEN
    -- Customer cash-out (kiosk / withdrawal lock leg) or a helper cash-out
    -- of wage balances held in the helper's partner_payable account.
    expected_direction_valid := credit_type = 'platform_treasury' AND NEW.agreement_id IS NULL AND (
      (debit_type = 'customer_wallet' AND NEW.partner_id IS NULL)
      OR (debit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND debit_partner_id = NEW.partner_id)
    );
  ELSIF NEW.transaction_type = 'fee' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'platform_revenue'
      AND NEW.partner_id IS NOT NULL AND debit_partner_id = NEW.partner_id AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'escheatment' THEN
    expected_direction_valid := debit_type IN ('customer_wallet', 'partner_payable') AND credit_type = 'unclaimed_property'
      AND NEW.agreement_id IS NULL
      AND (debit_type = 'customer_wallet' OR debit_partner_id = NEW.partner_id);
  ELSIF NEW.transaction_type = 'escheat_reclaim' THEN
    expected_direction_valid := debit_type = 'unclaimed_property' AND credit_type IN ('customer_wallet', 'partner_payable')
      AND NEW.agreement_id IS NULL
      AND (credit_type = 'customer_wallet' OR credit_partner_id = NEW.partner_id);
  ELSIF NEW.transaction_type = 'escheat_remittance' THEN
    expected_direction_valid := debit_type = 'unclaimed_property' AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'sub_bank_load' THEN
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := (debit_type = 'platform_treasury' OR debit_type = 'customer_wallet')
      AND credit_type = 'restaurant_sub_bank' AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  ELSIF NEW.transaction_type = 'sub_bank_redemption' THEN
    SELECT restaurant_id INTO debit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'restaurant_sub_bank' AND credit_type = 'partner_payable'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL
      AND credit_partner_id IS NOT DISTINCT FROM NEW.partner_id
      AND linked_partner_restaurant_id IS NOT DISTINCT FROM debit_restaurant_id;
  ELSIF NEW.transaction_type = 'sub_bank_refund' THEN
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'restaurant_sub_bank'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL
      AND debit_partner_id IS NOT DISTINCT FROM NEW.partner_id
      AND linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id;
  ELSIF NEW.transaction_type = 'sub_bank_opening_balance' THEN
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'restaurant_sub_bank'
      AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  ELSIF NEW.transaction_type = 'sub_bank_load_reversal' THEN
    SELECT restaurant_id INTO debit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'restaurant_sub_bank'
      AND credit_type = 'platform_treasury' AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM debit_restaurant_id);
  ELSIF NEW.transaction_type IN ('withdrawal_fee', 'transfer_fee') THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'platform_revenue' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'sub_bank_conversion' THEN
    expected_direction_valid := debit_type = 'restaurant_sub_bank' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'sub_bank_payout' THEN
    expected_direction_valid := debit_type = 'restaurant_sub_bank' AND credit_type = 'platform_treasury' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'sub_bank_payout_reversal' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'restaurant_sub_bank' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid for its type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Helper wage balances never go negative ───────────────────────────
ALTER TABLE oxsteed_credit_accounts
  ADD COLUMN IF NOT EXISTS non_negative_balance BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark existing helper payables. An account that is ALREADY negative is
-- left unmarked (the CHECK would reject it) and reported by the
-- safeguarding reconciliation instead of being silently rewritten.
UPDATE oxsteed_credit_accounts a
   SET non_negative_balance = TRUE
 WHERE a.account_type = 'partner_payable'
   AND a.balance_cents >= 0
   AND EXISTS (
     SELECT 1 FROM credit_participants cp
      WHERE cp.partner_id = a.partner_id AND cp.participant_type = 'helper'
   );

DO $$ BEGIN
  ALTER TABLE oxsteed_credit_accounts ADD CONSTRAINT oxsteed_credit_accounts_non_negative_check
    CHECK (NOT non_negative_balance OR balance_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION mark_oxsteed_credit_helper_payable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_type = 'partner_payable' AND EXISTS (
    SELECT 1 FROM credit_participants cp
     WHERE cp.partner_id = NEW.partner_id AND cp.participant_type = 'helper'
  ) THEN
    NEW.non_negative_balance := TRUE;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mark_oxsteed_credit_helper_payable ON oxsteed_credit_accounts;
CREATE TRIGGER trg_mark_oxsteed_credit_helper_payable
  BEFORE INSERT ON oxsteed_credit_accounts
  FOR EACH ROW EXECUTE FUNCTION mark_oxsteed_credit_helper_payable();

CREATE OR REPLACE FUNCTION mark_oxsteed_credit_helper_participant_accounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.participant_type = 'helper' THEN
    UPDATE oxsteed_credit_accounts
       SET non_negative_balance = TRUE
     WHERE account_type = 'partner_payable'
       AND partner_id = NEW.partner_id
       AND balance_cents >= 0
       AND non_negative_balance = FALSE;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mark_oxsteed_credit_helper_participant_accounts ON credit_participants;
CREATE TRIGGER trg_mark_oxsteed_credit_helper_participant_accounts
  AFTER INSERT OR UPDATE OF participant_type, partner_id ON credit_participants
  FOR EACH ROW EXECUTE FUNCTION mark_oxsteed_credit_helper_participant_accounts();
