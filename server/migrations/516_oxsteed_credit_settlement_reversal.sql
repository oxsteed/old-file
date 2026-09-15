-- Migration 516: make paid settlement reversals explicit and idempotent.
--
-- A reversal is a compensating journal movement. The original settlement and
-- its journal entries remain immutable historical evidence.

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'settlement_reversal', 'fee', 'expiration', 'chargeback', 'funding',
    'reserve_release', 'conversion_debit', 'conversion_fee', 'conversion_credit'
  ));

ALTER TABLE oxsteed_credit_settlements
  DROP CONSTRAINT IF EXISTS oxsteed_credit_settlements_status_check;

ALTER TABLE oxsteed_credit_settlements
  ADD CONSTRAINT oxsteed_credit_settlements_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'reversed', 'disputed', 'voided'));

CREATE TABLE IF NOT EXISTS oxsteed_credit_settlement_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_settlements(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  recovery_reference VARCHAR(160) NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id VARCHAR(160),
  request_ip INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_settlement_reversals_created
  ON oxsteed_credit_settlement_reversals(created_at DESC);

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_row RECORD;
  transaction_row RECORD;
BEGIN
  SELECT * INTO settlement_row
    FROM oxsteed_credit_settlements
   WHERE id = NEW.settlement_id;
  IF settlement_row.id IS NULL
     OR settlement_row.status NOT IN ('paid', 'reversed') THEN
    RAISE EXCEPTION 'Settlement reversal requires a paid settlement'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO transaction_row
    FROM oxsteed_credit_transactions
   WHERE id = NEW.transaction_id;
  IF transaction_row.id IS NULL
     OR transaction_row.status <> 'posted'
     OR transaction_row.transaction_type <> 'settlement_reversal'
     OR transaction_row.amount_cents <> settlement_row.net_cents
     OR transaction_row.currency_code <> settlement_row.currency_code
     OR transaction_row.partner_id <> settlement_row.partner_id
     OR transaction_row.agreement_id <> settlement_row.agreement_id
     OR transaction_row.reference_type <> 'credit_settlement'
     OR transaction_row.reference_id <> NEW.settlement_id::text THEN
    RAISE EXCEPTION 'Settlement reversal evidence does not match its compensating transaction'
      USING ERRCODE = '23514';
  END IF;

  IF NULLIF(BTRIM(NEW.recovery_reference), '') IS NULL
     OR NULLIF(BTRIM(NEW.reason), '') IS NULL THEN
    RAISE EXCEPTION 'Settlement reversal requires recovery evidence and a reason'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_reversal_guard ON oxsteed_credit_settlement_reversals;

CREATE TRIGGER oxsteed_credit_settlement_reversal_guard
  BEFORE INSERT OR UPDATE ON oxsteed_credit_settlement_reversals
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_reversal();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_types()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_type VARCHAR(32);
  credit_type VARCHAR(32);
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
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid for its type'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_partner_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_partner_id BIGINT;
  credit_partner_id BIGINT;
  agreement_partner_id BIGINT;
BEGIN
  SELECT partner_id INTO debit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
  SELECT partner_id INTO credit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type IN ('purchase', 'refund', 'settlement', 'settlement_reversal') THEN
    IF NEW.partner_id IS NULL OR NEW.agreement_id IS NULL THEN
      RAISE EXCEPTION 'OxSteed Credit restaurant movements require a partner and agreement' USING ERRCODE = '23514';
    END IF;
    SELECT partner_id INTO agreement_partner_id FROM oxsteed_credit_partner_agreements WHERE id = NEW.agreement_id;
    IF agreement_partner_id IS NULL OR agreement_partner_id IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION 'OxSteed Credit movement partner does not match its agreement' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.transaction_type IN ('purchase', 'settlement') AND credit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    IF NEW.transaction_type = 'purchase' THEN
      RAISE EXCEPTION 'OxSteed Credit purchase payable account does not match its partner' USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION 'OxSteed Credit settlement payable account does not match its partner' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.transaction_type = 'refund' AND debit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit refund payable account does not match its partner' USING ERRCODE = '23514';
  ELSIF NEW.transaction_type = 'settlement_reversal' AND credit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit settlement reversal payable account does not match its partner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('approved', 'disputed', 'voided'))
      OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'disputed', 'voided'))
      OR (OLD.status = 'paid' AND NEW.status IN ('disputed', 'reversed'))
      OR (OLD.status = 'disputed' AND NEW.status IN ('approved', 'voided'))
    ) THEN
      RAISE EXCEPTION 'Invalid OxSteed Credit settlement status transition' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'reversed'
     AND NOT EXISTS (SELECT 1 FROM oxsteed_credit_settlement_reversals WHERE settlement_id = NEW.id) THEN
    RAISE EXCEPTION 'A reversed OxSteed Credit settlement requires reversal evidence' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'paid' THEN
    IF NEW.net_cents > 0 AND NULLIF(BTRIM(NEW.payment_reference), '') IS NULL THEN
      RAISE EXCEPTION 'A non-zero OxSteed Credit settlement requires a payment reference' USING ERRCODE = '23514';
    END IF;
    IF NEW.paid_at IS NULL THEN
      RAISE EXCEPTION 'A paid OxSteed Credit settlement requires a paid timestamp' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_state_guard ON oxsteed_credit_settlements;
CREATE TRIGGER oxsteed_credit_settlement_state_guard
  BEFORE INSERT OR UPDATE OF status, net_cents, payment_reference, paid_at
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_state();
