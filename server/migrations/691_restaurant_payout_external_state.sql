-- Migration 691: durable restaurant payout state and external transfer recovery.
--
-- A restaurant payout now journals the liability movement and enqueues the
-- provider operation in one transaction. Stripe is called only by the
-- outbox worker, outside the database transaction. Stripe webhook evidence
-- advances the payout to completed or reversed.

ALTER TABLE restaurant_payouts
  DROP CONSTRAINT IF EXISTS restaurant_payouts_status_check;

ALTER TABLE restaurant_payouts
  ADD CONSTRAINT restaurant_payouts_status_check
  CHECK (status IN ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled', 'reversed'));

ALTER TABLE restaurant_payouts
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stripe_transfer_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_ledger_transaction_id BIGINT,
  ADD COLUMN IF NOT EXISTS transfer_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_transfer_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_transfer_attempt_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restaurant_payout_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES restaurant_payouts(id) ON DELETE RESTRICT,
  event_type VARCHAR(40) NOT NULL DEFAULT 'create_stripe_transfer'
    CHECK (event_type = 'create_stripe_transfer'),
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'attention')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  lease_token UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_restaurant_payout_outbox_payout UNIQUE (payout_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_payout_outbox_claim
  ON restaurant_payout_outbox (status, available_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_restaurant_payouts_reconcile
  ON restaurant_payouts (status, updated_at)
  WHERE status IN ('approved', 'processing');

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'settlement_reversal', 'fee', 'expiration', 'chargeback', 'funding',
    'reserve_release', 'conversion_debit', 'conversion_fee', 'conversion_credit',
    'cash_out', 'sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund',
    'sub_bank_opening_balance', 'withdrawal_fee', 'transfer_fee',
    'sub_bank_conversion', 'sub_bank_payout', 'sub_bank_payout_reversal'
  ));

-- Keep the existing direction guard and add the compensating payout leg.
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
