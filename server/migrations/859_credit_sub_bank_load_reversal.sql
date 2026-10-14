-- Migration 859: journal type for Phase 2 restaurant credit refunds.
--
-- When a restaurant refunds wallet credit to a customer, the wallet debit
-- dual-posts to the central journal as 'sub_bank_load_reversal': the exact
-- reversal of the 'sub_bank_load' issuance posting (debit restaurant_sub_bank,
-- credit platform_treasury). The restaurant already paid the customer back
-- directly over Stripe, so no partner_payable is created (unlike
-- sub_bank_redemption, where the platform owes the restaurant via settlement).

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
    'sub_bank_payout_reversal', 'sub_bank_load_reversal'
  ));

-- Keep the existing direction guard (migration 691) and add the compensating
-- load-reversal leg for restaurant credit refunds.
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
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'settlement_reversal' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_payable' AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'sub_bank_load' THEN
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := (debit_type = 'platform_treasury' OR debit_type = 'customer_wallet')
      AND credit_type = 'restaurant_sub_bank' AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  ELSIF NEW.transaction_type = 'sub_bank_redemption' THEN
    SELECT restaurant_id INTO debit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
    SELECT partner_id INTO credit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'restaurant_sub_bank' AND credit_type = 'partner_payable'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL
      AND credit_partner_id IS NOT DISTINCT FROM NEW.partner_id
      AND linked_partner_restaurant_id IS NOT DISTINCT FROM debit_restaurant_id;
  ELSIF NEW.transaction_type = 'sub_bank_refund' THEN
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT partner_id INTO debit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
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
    -- Restaurant credit refunded to the customer (Phase 2): the restaurant's
    -- customer-credit liability falls and the issuance funding returns to the
    -- platform treasury (exact reversal of sub_bank_load).
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
