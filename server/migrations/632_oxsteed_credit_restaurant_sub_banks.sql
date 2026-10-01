-- Migration 632: OxSteed Credit restaurant sub-bank accounts (Phase 1 central-bank model).
--
-- Adds a `restaurant_sub_bank` account type to the central double-entry journal:
-- one account per (restaurant_id, currency_code) whose balance must always equal
-- the aggregate outstanding customer food-wallet balances at that restaurant.
-- Every food-wallet money mutation dual-posts a balanced pair through
-- postJournalTransaction (see server/services/oxsteedCreditSubBankService.js),
-- so the balanced-pair guard (424), append-only guard (430), and ledger-write
-- guard (491) all apply to sub-bank movements.
--
-- New transaction types: sub_bank_load (issuance), sub_bank_redemption
-- (customer spend), sub_bank_refund (exact reversal of a redemption), and
-- sub_bank_opening_balance (one-time backfill of pre-existing outstanding).
--
-- NOTE on the balance floor: migration 517's balance>=0 check intentionally
-- still applies to restaurant_sub_bank. Outstanding customer credit is a
-- non-negative liability, so restaurant_sub_bank is NOT added to the
-- exemption list.
--
-- NOTE on backfill: the one-time backfill of existing outstanding balances is
-- NOT done here. Journal postings require the ledger HMAC secret, which is not
-- guaranteed to be present in the deploy pipeline. After deploy, run the
-- idempotent script `npm run backfill:sub-banks` from server/
-- (server/scripts/backfill-restaurant-sub-banks.js) with the ledger secret
-- configured.

-- 1. Owner column linking a sub-bank account to its restaurant.
ALTER TABLE oxsteed_credit_accounts
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE RESTRICT;

-- 2. Extend the account_type check with restaurant_sub_bank.
ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_account_type_check;
ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_account_type_check
  CHECK (account_type IN (
    'customer_wallet', 'partner_payable', 'partner_reserve',
    'platform_treasury', 'platform_revenue', 'restaurant_sub_bank'
  ));

-- 3. Owner check: restaurant_sub_bank requires restaurant_id and no other owner.
ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_owner_check;
ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_owner_check
  CHECK (
    (account_type = 'customer_wallet' AND customer_id IS NOT NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (account_type IN ('partner_payable', 'partner_reserve') AND customer_id IS NULL AND partner_id IS NOT NULL AND restaurant_id IS NULL)
    OR (account_type IN ('platform_treasury', 'platform_revenue') AND customer_id IS NULL AND partner_id IS NULL AND restaurant_id IS NULL)
    OR (account_type = 'restaurant_sub_bank' AND restaurant_id IS NOT NULL AND customer_id IS NULL AND partner_id IS NULL)
  );

-- 4. Exactly one sub-bank account per (restaurant_id, currency_code).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_restaurant_sub_bank
  ON oxsteed_credit_accounts (restaurant_id, currency_code)
  WHERE account_type = 'restaurant_sub_bank';

-- 5. Extend the transaction_type check with the sub-bank movement types.
ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;
ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'settlement_reversal', 'fee', 'expiration', 'chargeback', 'funding',
    'reserve_release', 'conversion_debit', 'conversion_fee', 'conversion_credit',
    'cash_out', 'sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund',
    'sub_bank_opening_balance'
  ));

-- 6. Direction guards for the new types. This recreates migration 516's
-- function with the same branches for the existing types plus four new ones.
-- The partner/restaurant linkage checks below make it impossible to post a
-- redemption or refund against the wrong restaurant's sub-bank or payable.
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
  SELECT account_type INTO debit_type FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
  SELECT account_type INTO credit_type FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type = 'load' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'purchase' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'partner_payable';
  ELSIF NEW.transaction_type = 'refund' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'customer_wallet';
  ELSIF NEW.transaction_type = 'transfer' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'settlement' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'platform_treasury' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'settlement_reversal' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'sub_bank_load' THEN
    -- Issuance of restaurant credit: platform_treasury (or a customer_wallet
    -- when the load is funded from OxSteed credit) -> restaurant_sub_bank.
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := (debit_type = 'platform_treasury' OR debit_type = 'customer_wallet')
      AND credit_type = 'restaurant_sub_bank'
      AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  ELSIF NEW.transaction_type = 'sub_bank_redemption' THEN
    -- Customer spends restaurant credit: the restaurant's customer-credit
    -- liability falls and the platform now owes the restaurant the same amount.
    SELECT restaurant_id INTO debit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
    SELECT partner_id INTO credit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'restaurant_sub_bank'
      AND credit_type = 'partner_payable'
      AND NEW.partner_id IS NOT NULL
      AND NEW.agreement_id IS NULL
      AND credit_partner_id IS NOT DISTINCT FROM NEW.partner_id
      AND linked_partner_restaurant_id IS NOT DISTINCT FROM debit_restaurant_id;
  ELSIF NEW.transaction_type = 'sub_bank_refund' THEN
    -- Exact reversal of a redemption: platform payable back to the sub-bank.
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT partner_id INTO debit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'partner_payable'
      AND credit_type = 'restaurant_sub_bank'
      AND NEW.partner_id IS NOT NULL
      AND NEW.agreement_id IS NULL
      AND debit_partner_id IS NOT DISTINCT FROM NEW.partner_id
      AND linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id;
  ELSIF NEW.transaction_type = 'sub_bank_opening_balance' THEN
    -- One-time backfill of pre-existing outstanding (see header note).
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'platform_treasury'
      AND credit_type = 'restaurant_sub_bank'
      AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid for its type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
