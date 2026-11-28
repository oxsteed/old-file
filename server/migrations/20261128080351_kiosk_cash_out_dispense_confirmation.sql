-- Migration: kiosk cash-out dispense confirmation (G13-B3, D-754).
--
-- A kiosk cash-out debited the wallet the moment the journal leg posted,
-- before any physical cash was dispensed, and nothing reconciled the cash:
-- no dispenser integration, no dispense-confirmation endpoint, and the
-- shift closeout's `cash_out_reconciled` check compared the ledger list
-- against the ledger aggregate (the same table twice).
--
-- This migration adds the dispense record the confirmation flow writes
-- (one row per cash-out, pending until the kiosk reports the dispense
-- outcome), the opening-cash column the closeout's physical leg reads,
-- and the `cash_out_reversal` journal type the failure path posts (the
-- exact reversal of a cash-out leg: platform_treasury -> customer
-- wallet, same direction as a 'load'). The direction guard below is the
-- live function byte-for-byte plus the one new branch.

CREATE TABLE IF NOT EXISTS oxsteed_credit_cash_out_dispenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  kiosk_device_id BIGINT NOT NULL,
  customer_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispensed', 'failed', 'partial')),
  dispensed_cents INTEGER NOT NULL DEFAULT 0 CHECK (dispensed_cents >= 0),
  reversal_transaction_id UUID REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_cash_out_dispenses_device_status
  ON oxsteed_credit_cash_out_dispenses (kiosk_device_id, status);

-- Physical cash in the cassette when the shift opens. Null when the
-- cashier did not count it: the closeout's physical leg is then skipped
-- and noted, never invented.
ALTER TABLE oxsteed_credit_kiosk_shifts
  ADD COLUMN IF NOT EXISTS opening_cash_cents INTEGER;

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'media_creator_settlement', 'settlement_reversal', 'fee', 'expiration',
    'chargeback', 'funding', 'reserve_release', 'conversion_debit',
    'conversion_fee', 'conversion_credit', 'cash_out', 'cash_out_reversal',
    'sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund',
    'sub_bank_opening_balance', 'withdrawal_fee', 'transfer_fee',
    'sub_bank_conversion', 'sub_bank_payout', 'sub_bank_payout_reversal',
    'sub_bank_load_reversal', 'escheatment', 'escheat_reclaim',
    'escheat_remittance'
  ));

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
  ELSIF NEW.transaction_type = 'cash_out_reversal' THEN
    -- G13-B3: exact reversal of a kiosk cash-out whose dispenser failed
    -- to dispense. The debited value returns from platform_treasury to
    -- the customer wallet, the same direction as a 'load'.
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
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
