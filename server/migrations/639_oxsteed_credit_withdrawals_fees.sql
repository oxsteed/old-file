-- Migration 639: OxSteed Credit withdrawals, fee schedule, restaurant conversions.
--
-- Phase 6 of the central-bank model: money movement OUT of and BETWEEN
-- wallets, plus the fee schedule those flows need (gaps 5, 6, 12).
--
-- 1. oxsteed_credit_withdrawals: customer wallet -> bank via Stripe.
--    Lifecycle mirrors the top-up flow in reverse:
--      requested  -> customer asked; compliance + destination verified,
--                    no money moved yet
--      approved   -> an admin approved the request (recorded reviewer);
--                    transitional, immediately followed by initiation
--      processing -> Stripe transfer created AND the `cash_out` lock leg
--                    posted (customer_wallet -> platform_treasury); the
--                    wallet balance is already reduced, so the customer
--                    cannot double-spend while the payout is in flight
--      paid       -> Stripe transfer confirmed via webhook; terminal
--      failed     -> Stripe transfer failed/reversed; a compensating `load`
--                    returns the gross amount to the wallet (append-only:
--                    the original cash_out is never edited)
--      rejected   -> admin rejected the request with a reason; terminal
--      cancelled  -> customer cancelled while still requested; terminal
--      requires_attention -> Stripe money moved but the lock journal post
--                    failed; critical incident raised, Stripe redelivery
--                    retries (same pattern as top-ups)
--
--    destination_account_ref holds the Stripe connected-account id (or bank
--    token reference). Raw bank account numbers are NEVER stored here.
--
-- 2. oxsteed_credit_fee_schedule: deterministic fees per operation type.
--    fee = clamp(fixed_cents + round(amount_cents * percentage_bps / 10000),
--                min_fee_cents, max_fee_cents).
--    The fee quoted at request time is stored on the withdrawal row and the
--    posted fee leg must equal it exactly: no hidden fees.
--
-- 3. oxsteed_credit_restaurant_conversions: value moved between the
--    restaurant-credit subsystem (food wallets) and the OxSteed credit
--    central journal, both directions, in one DB transaction.
--
-- 4. New journal transaction types: withdrawal_fee, transfer_fee (both
--    customer_wallet -> platform_revenue, mirroring conversion_fee) and
--    sub_bank_conversion (restaurant_sub_bank -> customer_wallet).
--
-- Non-code gates that remain (documented, not faked): banking partnerships,
-- money-transmitter licensing, actual regulatory filings.

CREATE TABLE IF NOT EXISTS oxsteed_credit_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id BIGINT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  status VARCHAR(32) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'processing', 'paid', 'failed',
                      'rejected', 'cancelled', 'requires_attention')),
  stripe_transfer_id VARCHAR(255) NULL UNIQUE,
  destination_account_ref VARCHAR(255) NULL,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  journal_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  journal_fee_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  journal_reversal_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_reason VARCHAR(500) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oxsteed_credit_withdrawals_fee_within_amount CHECK (fee_cents < amount_cents),
  CONSTRAINT oxsteed_credit_withdrawals_net_math CHECK (net_cents = amount_cents - fee_cents)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_withdrawals_customer_status
  ON oxsteed_credit_withdrawals(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_withdrawals_status_created
  ON oxsteed_credit_withdrawals(status, created_at);

CREATE TABLE IF NOT EXISTS oxsteed_credit_fee_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type VARCHAR(32) NOT NULL
    CHECK (operation_type IN ('withdrawal', 'transfer', 'conversion', 'top_up')),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  fixed_cents BIGINT NOT NULL DEFAULT 0 CHECK (fixed_cents >= 0),
  percentage_bps INTEGER NOT NULL DEFAULT 0 CHECK (percentage_bps >= 0 AND percentage_bps <= 10000),
  min_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (min_fee_cents >= 0),
  max_fee_cents BIGINT NULL CHECK (max_fee_cents IS NULL OR max_fee_cents >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oxsteed_credit_fee_schedule_min_within_max
    CHECK (max_fee_cents IS NULL OR min_fee_cents <= max_fee_cents)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_fee_schedule_active
  ON oxsteed_credit_fee_schedule(operation_type, currency_code)
  WHERE is_active AND effective_to IS NULL;

-- Seed defaults (USD). Operators change these via the admin fee editor or
-- SQL; deploy-time env overrides are read by the fee service at runtime.
INSERT INTO oxsteed_credit_fee_schedule
  (operation_type, currency_code, fixed_cents, percentage_bps, min_fee_cents, max_fee_cents)
VALUES
  ('withdrawal', 'USD', 100, 100, 100, 2500),
  ('transfer',   'USD', 0,   50,  0,   1000),
  ('conversion', 'USD', 0,   100, 0,   2500),
  ('top_up',     'USD', 0,   0,   0,   NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS oxsteed_credit_restaurant_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL,
  direction VARCHAR(24) NOT NULL
    CHECK (direction IN ('to_restaurant', 'from_restaurant')),
  source_amount_cents BIGINT NOT NULL CHECK (source_amount_cents > 0),
  converted_amount_cents BIGINT NOT NULL CHECK (converted_amount_cents > 0),
  fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  rate NUMERIC(18, 9) NOT NULL CHECK (rate > 0 AND rate <= 1),
  status VARCHAR(24) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  wallet_ledger_entry_id BIGINT NULL,
  journal_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  journal_fee_transaction_id UUID NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_restaurant_conversions_customer
  ON oxsteed_credit_restaurant_conversions(customer_id, created_at);

-- Extend the transaction_type check with the Phase 6 movement types.
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
    'sub_bank_conversion'
  ));

-- Direction guards for the new types. This recreates migration 632's
-- function with the same branches plus three new ones. withdrawal_fee and
-- transfer_fee mirror conversion_fee (customer_wallet -> platform_revenue);
-- sub_bank_conversion moves value from a restaurant sub-bank into a
-- customer OxSteed wallet (the reverse of the oxsteed-funded sub_bank_load).
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
    SELECT restaurant_id INTO credit_restaurant_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;
    SELECT restaurant_id INTO linked_partner_restaurant_id FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
    expected_direction_valid := debit_type = 'platform_treasury'
      AND credit_type = 'restaurant_sub_bank'
      AND NEW.agreement_id IS NULL
      AND (NEW.partner_id IS NULL OR linked_partner_restaurant_id IS NOT DISTINCT FROM credit_restaurant_id);
  ELSIF NEW.transaction_type = 'withdrawal_fee' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'platform_revenue' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'transfer_fee' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'platform_revenue' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'sub_bank_conversion' THEN
    expected_direction_valid := debit_type = 'restaurant_sub_bank' AND credit_type = 'customer_wallet' AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid for its type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
