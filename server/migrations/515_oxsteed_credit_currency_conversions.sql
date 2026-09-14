-- Migration 515: add an explicit, quoted currency-conversion workflow.
--
-- FX is never inferred from a currency code. Every conversion must consume a
-- short-lived provider quote and is represented by same-currency journal
-- transactions tied together by an immutable conversion record.

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'fee', 'expiration', 'chargeback', 'funding', 'reserve_release',
    'conversion_debit', 'conversion_fee', 'conversion_credit'
  ));

CREATE TABLE IF NOT EXISTS oxsteed_credit_currency_quotes (
  id BIGSERIAL PRIMARY KEY,
  source_currency_code CHAR(3) NOT NULL CHECK (source_currency_code ~ '^[A-Z]{3}$'),
  target_currency_code CHAR(3) NOT NULL CHECK (target_currency_code ~ '^[A-Z]{3}$'),
  source_amount_minor_units BIGINT NOT NULL CHECK (source_amount_minor_units > 0),
  target_amount_minor_units BIGINT NOT NULL CHECK (target_amount_minor_units > 0),
  fee_amount_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount_minor_units >= 0),
  rate_numerator NUMERIC(38, 0) NOT NULL CHECK (rate_numerator > 0),
  rate_denominator NUMERIC(38, 0) NOT NULL CHECK (rate_denominator > 0),
  rounding_mode VARCHAR(20) NOT NULL DEFAULT 'half_up'
    CHECK (rounding_mode IN ('half_up')),
  provider VARCHAR(80) NOT NULL,
  provider_quote_reference VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'consumed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_currency_code <> target_currency_code),
  CHECK (provider <> ''),
  CHECK (provider_quote_reference <> ''),
  CHECK (reason <> ''),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_currency_quote_provider_ref
  ON oxsteed_credit_currency_quotes(provider, provider_quote_reference);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_currency_quotes_open
  ON oxsteed_credit_currency_quotes(status, expires_at);

CREATE TABLE IF NOT EXISTS oxsteed_credit_currency_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quote_id BIGINT NOT NULL UNIQUE REFERENCES oxsteed_credit_currency_quotes(id) ON DELETE RESTRICT,
  source_currency_code CHAR(3) NOT NULL CHECK (source_currency_code ~ '^[A-Z]{3}$'),
  target_currency_code CHAR(3) NOT NULL CHECK (target_currency_code ~ '^[A-Z]{3}$'),
  source_amount_minor_units BIGINT NOT NULL CHECK (source_amount_minor_units > 0),
  target_amount_minor_units BIGINT NOT NULL CHECK (target_amount_minor_units > 0),
  fee_amount_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (fee_amount_minor_units >= 0),
  debit_transaction_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  fee_transaction_id UUID UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  credit_transaction_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id VARCHAR(160),
  request_ip INET,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_currency_code <> target_currency_code),
  CHECK (debit_transaction_id <> credit_transaction_id),
  CHECK (fee_transaction_id IS NULL OR fee_transaction_id NOT IN (debit_transaction_id, credit_transaction_id))
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_currency_conversions_customer
  ON oxsteed_credit_currency_conversions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_currency_conversions_currencies
  ON oxsteed_credit_currency_conversions(source_currency_code, target_currency_code, created_at DESC);

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_currency_quote_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source_currency_code IS DISTINCT FROM NEW.source_currency_code
     OR OLD.target_currency_code IS DISTINCT FROM NEW.target_currency_code
     OR OLD.source_amount_minor_units IS DISTINCT FROM NEW.source_amount_minor_units
     OR OLD.target_amount_minor_units IS DISTINCT FROM NEW.target_amount_minor_units
     OR OLD.fee_amount_minor_units IS DISTINCT FROM NEW.fee_amount_minor_units
     OR OLD.rate_numerator IS DISTINCT FROM NEW.rate_numerator
     OR OLD.rate_denominator IS DISTINCT FROM NEW.rate_denominator
     OR OLD.rounding_mode IS DISTINCT FROM NEW.rounding_mode
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.provider_quote_reference IS DISTINCT FROM NEW.provider_quote_reference
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.reason IS DISTINCT FROM NEW.reason
     OR OLD.metadata IS DISTINCT FROM NEW.metadata
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key THEN
    RAISE EXCEPTION 'OxSteed Credit currency quote terms are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'open' AND NEW.status NOT IN ('open', 'consumed', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid OxSteed Credit currency quote status transition' USING ERRCODE = '23514';
  ELSIF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A terminal OxSteed Credit currency quote cannot change status' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_currency_quote_immutable_guard ON oxsteed_credit_currency_quotes;
CREATE TRIGGER oxsteed_credit_currency_quote_immutable_guard
  BEFORE UPDATE ON oxsteed_credit_currency_quotes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_currency_quote_update();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_currency_conversion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  quote_source CHAR(3);
  quote_target CHAR(3);
  quote_source_amount BIGINT;
  quote_target_amount BIGINT;
  quote_fee_amount BIGINT;
  quote_status VARCHAR(20);
  debit_type VARCHAR(32);
  debit_currency CHAR(3);
  debit_customer UUID;
  debit_credit_account BIGINT;
  debit_amount BIGINT;
  fee_type VARCHAR(32);
  fee_currency CHAR(3);
  fee_debit_account BIGINT;
  fee_customer UUID;
  fee_amount BIGINT;
  fee_credit_type VARCHAR(32);
  credit_type VARCHAR(32);
  credit_currency CHAR(3);
  credit_customer UUID;
  credit_debit_type VARCHAR(32);
  credit_amount BIGINT;
BEGIN
  SELECT source_currency_code, target_currency_code,
         source_amount_minor_units, target_amount_minor_units,
         fee_amount_minor_units, status
    INTO quote_source, quote_target, quote_source_amount,
         quote_target_amount, quote_fee_amount, quote_status
    FROM oxsteed_credit_currency_quotes
   WHERE id = NEW.quote_id;

  SELECT t.transaction_type, t.currency_code, a.customer_id, t.credit_account_id, t.amount_cents
    INTO debit_type, debit_currency, debit_customer, debit_credit_account, debit_amount
    FROM oxsteed_credit_transactions t
    JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
   WHERE t.id = NEW.debit_transaction_id;

  SELECT t.transaction_type, t.currency_code, t.debit_account_id, a.account_type,
         da.customer_id, t.amount_cents
    INTO fee_type, fee_currency, fee_debit_account, fee_credit_type,
         fee_customer, fee_amount
    FROM oxsteed_credit_transactions t
    JOIN oxsteed_credit_accounts a ON a.id = t.credit_account_id
    JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
   WHERE t.id = NEW.fee_transaction_id;

  SELECT t.transaction_type, t.currency_code, a.customer_id, da.account_type, t.amount_cents
    INTO credit_type, credit_currency, credit_customer, credit_debit_type, credit_amount
    FROM oxsteed_credit_transactions t
    JOIN oxsteed_credit_accounts a ON a.id = t.credit_account_id
    JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
   WHERE t.id = NEW.credit_transaction_id;

  IF quote_source IS NULL
     OR quote_status IS DISTINCT FROM 'open'
     OR quote_source IS DISTINCT FROM NEW.source_currency_code
     OR quote_target IS DISTINCT FROM NEW.target_currency_code
     OR quote_source_amount IS DISTINCT FROM NEW.source_amount_minor_units
     OR quote_target_amount IS DISTINCT FROM NEW.target_amount_minor_units
     OR quote_fee_amount IS DISTINCT FROM NEW.fee_amount_minor_units
     OR debit_type IS DISTINCT FROM 'conversion_debit'
     OR debit_currency IS DISTINCT FROM NEW.source_currency_code
     OR debit_customer IS DISTINCT FROM NEW.customer_id
     OR debit_amount IS DISTINCT FROM NEW.source_amount_minor_units
     OR fee_type IS DISTINCT FROM (CASE WHEN NEW.fee_transaction_id IS NULL THEN NULL ELSE 'conversion_fee' END)
     OR (NEW.fee_transaction_id IS NOT NULL AND (fee_currency IS DISTINCT FROM NEW.source_currency_code
       OR fee_customer IS DISTINCT FROM NEW.customer_id
       OR fee_credit_type IS DISTINCT FROM 'platform_revenue'
       OR fee_amount IS DISTINCT FROM NEW.fee_amount_minor_units
       OR fee_debit_account IS NULL))
     OR (NEW.fee_transaction_id IS NULL AND NEW.fee_amount_minor_units <> 0)
     OR credit_type IS DISTINCT FROM 'conversion_credit'
     OR credit_currency IS DISTINCT FROM NEW.target_currency_code
     OR credit_customer IS DISTINCT FROM NEW.customer_id
     OR credit_amount IS DISTINCT FROM NEW.target_amount_minor_units
     OR credit_debit_type IS DISTINCT FROM 'platform_treasury' THEN
    RAISE EXCEPTION 'OxSteed Credit currency conversion does not match its quote and journal transactions'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_currency_conversion_guard ON oxsteed_credit_currency_conversions;
CREATE TRIGGER oxsteed_credit_currency_conversion_guard
  BEFORE INSERT OR UPDATE ON oxsteed_credit_currency_conversions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_currency_conversion();

CREATE OR REPLACE RULE oxsteed_credit_currency_conversion_no_update AS
  ON UPDATE TO oxsteed_credit_currency_conversions DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_currency_conversion_no_delete AS
  ON DELETE TO oxsteed_credit_currency_conversions DO INSTEAD NOTHING;

-- Extend the database direction guard for the three same-currency legs.
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
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'customer_wallet'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'purchase' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'partner_payable';
  ELSIF NEW.transaction_type = 'refund' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'customer_wallet';
  ELSIF NEW.transaction_type = 'transfer' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'customer_wallet'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'settlement' THEN
    expected_direction_valid := debit_type = 'partner_payable' AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'adjustment' THEN
    expected_direction_valid := NEW.partner_id IS NULL AND NEW.agreement_id IS NULL
      AND (CASE NEW.metadata->>'direction'
        WHEN 'credit' THEN debit_type = 'platform_treasury' AND credit_type = 'customer_wallet'
        WHEN 'debit' THEN debit_type = 'customer_wallet' AND credit_type = 'platform_treasury'
        ELSE FALSE END);
  ELSIF NEW.transaction_type = 'funding' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_reserve'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'reserve_release' THEN
    expected_direction_valid := debit_type = 'partner_reserve' AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'conversion_debit' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'conversion_fee' THEN
    expected_direction_valid := debit_type = 'customer_wallet' AND credit_type = 'platform_revenue'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'conversion_credit' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'customer_wallet'
      AND NEW.partner_id IS NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type IN ('fee', 'expiration', 'chargeback') THEN
    expected_direction_valid := FALSE;
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid or the transaction type is reserved'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Migration 466 attached one trigger function to settlements and transactions,
-- but directly referenced the settlement-only NEW.net_cents field. Reading the
-- optional field through the row JSON keeps both trigger relations valid.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_payment_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_transaction_count INTEGER;
  new_net_cents BIGINT := NULLIF(to_jsonb(NEW)->>'net_cents', '')::BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'oxsteed_credit_settlements' AND NEW.status = 'paid' AND COALESCE(new_net_cents, 0) > 0 THEN
    SELECT COUNT(*)::INTEGER
      INTO matching_transaction_count
      FROM oxsteed_credit_transactions t
     WHERE t.transaction_type = 'settlement'
       AND t.status = 'posted'
       AND t.partner_id = NEW.partner_id
       AND t.agreement_id = NEW.agreement_id
       AND t.amount_cents = new_net_cents
       AND t.currency_code = NEW.currency_code
       AND t.reference_type = 'credit_settlement'
       AND t.reference_id = NEW.id::TEXT
       AND t.metadata->>'paymentReference' = NEW.payment_reference;

    IF matching_transaction_count <> 1 THEN
      RAISE EXCEPTION 'A paid OxSteed Credit settlement requires one matching journal payment'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'oxsteed_credit_transactions'
        AND NEW.transaction_type = 'settlement'
        AND NEW.status = 'posted'
        AND NEW.reference_type = 'credit_settlement' THEN
    IF EXISTS (
      SELECT 1
        FROM oxsteed_credit_settlements s
       WHERE s.id::TEXT = NEW.reference_id
         AND s.status = 'paid'
         AND (s.net_cents <> NEW.amount_cents
           OR s.currency_code IS DISTINCT FROM NEW.currency_code
           OR s.partner_id IS DISTINCT FROM NEW.partner_id
           OR s.agreement_id IS DISTINCT FROM NEW.agreement_id
           OR s.payment_reference IS DISTINCT FROM NEW.metadata->>'paymentReference')
    ) THEN
      RAISE EXCEPTION 'Credit settlement journal evidence does not match the paid settlement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
