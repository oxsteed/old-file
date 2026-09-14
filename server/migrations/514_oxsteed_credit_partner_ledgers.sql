-- Migration 514: make each restaurant's Credit operating ledger explicit.
--
-- The existing partner payable account remains the source of truth for earned
-- restaurant value. This migration adds a first-class restaurant ledger record,
-- a reserve account, and immutable funding records without moving or rewriting
-- any historical journal entries.

ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_account_type_check;

ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_account_type_check
  CHECK (account_type IN (
    'customer_wallet', 'partner_payable', 'partner_reserve',
    'platform_treasury', 'platform_revenue'
  ));

ALTER TABLE oxsteed_credit_accounts
  DROP CONSTRAINT IF EXISTS oxsteed_credit_accounts_balance_cents_check;

ALTER TABLE oxsteed_credit_accounts
  ADD CONSTRAINT oxsteed_credit_accounts_balance_cents_check
  CHECK (
    balance_cents >= 0
    OR account_type IN ('partner_payable', 'partner_reserve', 'platform_treasury', 'platform_revenue')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_partner_reserve_account
  ON oxsteed_credit_accounts(partner_id, currency_code)
  WHERE account_type = 'partner_reserve';

ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'fee', 'expiration', 'chargeback', 'funding', 'reserve_release'
  ));

CREATE TABLE IF NOT EXISTS oxsteed_credit_partner_ledgers (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL UNIQUE REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  ledger_code VARCHAR(100) NOT NULL UNIQUE,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  payable_account_id BIGINT NOT NULL UNIQUE REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  reserve_account_id BIGINT NOT NULL UNIQUE REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payable_account_id <> reserve_account_id)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_partner_ledgers_status
  ON oxsteed_credit_partner_ledgers(status, updated_at DESC);

-- Give every enrolled restaurant a reserve account, including partners that
-- have not received a purchase yet and therefore had no payable account.
INSERT INTO oxsteed_credit_accounts
  (account_type, partner_id, currency_code)
SELECT 'partner_payable', p.id, p.settlement_currency_code
  FROM oxsteed_credit_partners p
 WHERE NOT EXISTS (
   SELECT 1 FROM oxsteed_credit_accounts a
    WHERE a.account_type = 'partner_payable'
      AND a.partner_id = p.id
      AND a.currency_code = p.settlement_currency_code
 );

INSERT INTO oxsteed_credit_accounts
  (account_type, partner_id, currency_code)
SELECT 'partner_reserve', p.id, p.settlement_currency_code
  FROM oxsteed_credit_partners p
 WHERE NOT EXISTS (
   SELECT 1 FROM oxsteed_credit_accounts a
    WHERE a.account_type = 'partner_reserve'
      AND a.partner_id = p.id
      AND a.currency_code = p.settlement_currency_code
 );

INSERT INTO oxsteed_credit_partner_ledgers
  (partner_id, ledger_code, currency_code, payable_account_id, reserve_account_id)
SELECT p.id,
       'restaurant-credit:' || p.id::text || ':' || p.settlement_currency_code,
       p.settlement_currency_code,
       payable.id,
       reserve.id
  FROM oxsteed_credit_partners p
  JOIN oxsteed_credit_accounts payable
    ON payable.account_type = 'partner_payable'
   AND payable.partner_id = p.id
   AND payable.currency_code = p.settlement_currency_code
  JOIN oxsteed_credit_accounts reserve
    ON reserve.account_type = 'partner_reserve'
   AND reserve.partner_id = p.id
   AND reserve.currency_code = p.settlement_currency_code
 ON CONFLICT (partner_id) DO NOTHING;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_partner_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  payable_type VARCHAR(32);
  payable_partner BIGINT;
  payable_currency CHAR(3);
  reserve_type VARCHAR(32);
  reserve_partner BIGINT;
  reserve_currency CHAR(3);
  partner_currency CHAR(3);
BEGIN
  SELECT settlement_currency_code INTO partner_currency
    FROM oxsteed_credit_partners WHERE id = NEW.partner_id;
  SELECT account_type, partner_id, currency_code
    INTO payable_type, payable_partner, payable_currency
    FROM oxsteed_credit_accounts WHERE id = NEW.payable_account_id;
  SELECT account_type, partner_id, currency_code
    INTO reserve_type, reserve_partner, reserve_currency
    FROM oxsteed_credit_accounts WHERE id = NEW.reserve_account_id;

  IF partner_currency IS NULL
     OR payable_type <> 'partner_payable'
     OR payable_partner IS DISTINCT FROM NEW.partner_id
     OR payable_currency IS DISTINCT FROM NEW.currency_code
     OR reserve_type <> 'partner_reserve'
     OR reserve_partner IS DISTINCT FROM NEW.partner_id
     OR reserve_currency IS DISTINCT FROM NEW.currency_code
     OR partner_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit partner ledger accounts do not match its partner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_partner_ledger_guard ON oxsteed_credit_partner_ledgers;
CREATE TRIGGER oxsteed_credit_partner_ledger_guard
  BEFORE INSERT OR UPDATE OF partner_id, currency_code, payable_account_id,
    reserve_account_id
  ON oxsteed_credit_partner_ledgers
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_partner_ledger();

CREATE TABLE IF NOT EXISTS oxsteed_credit_partner_funding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_ledger_id BIGINT NOT NULL REFERENCES oxsteed_credit_partner_ledgers(id) ON DELETE RESTRICT,
  partner_id BIGINT NOT NULL REFERENCES oxsteed_credit_partners(id) ON DELETE RESTRICT,
  reserve_account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL UNIQUE REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('fund', 'release')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  external_reference VARCHAR(160) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  correlation_id VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (external_reference <> ''),
  CHECK (reason <> '')
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_partner_funding_ledger
  ON oxsteed_credit_partner_funding_records(partner_ledger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_partner_funding_partner
  ON oxsteed_credit_partner_funding_records(partner_id, currency_code, created_at DESC);

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_partner_funding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_partner BIGINT;
  ledger_currency CHAR(3);
  ledger_reserve BIGINT;
  transaction_type VARCHAR(32);
  transaction_partner BIGINT;
  transaction_currency CHAR(3);
  transaction_debit BIGINT;
  transaction_credit BIGINT;
BEGIN
  SELECT partner_id, currency_code, reserve_account_id
    INTO ledger_partner, ledger_currency, ledger_reserve
    FROM oxsteed_credit_partner_ledgers
   WHERE id = NEW.partner_ledger_id;
  SELECT transaction_type, partner_id, currency_code, debit_account_id,
         credit_account_id
    INTO transaction_type, transaction_partner, transaction_currency,
         transaction_debit, transaction_credit
    FROM oxsteed_credit_transactions
   WHERE id = NEW.transaction_id;

  IF ledger_partner IS DISTINCT FROM NEW.partner_id
     OR ledger_currency IS DISTINCT FROM NEW.currency_code
     OR ledger_reserve IS DISTINCT FROM NEW.reserve_account_id
     OR transaction_partner IS DISTINCT FROM NEW.partner_id
     OR transaction_currency IS DISTINCT FROM NEW.currency_code
     OR transaction_type IS DISTINCT FROM (CASE NEW.direction
       WHEN 'fund' THEN 'funding' ELSE 'reserve_release' END)
     OR (NEW.direction = 'fund' AND transaction_credit IS DISTINCT FROM NEW.reserve_account_id)
     OR (NEW.direction = 'release' AND transaction_debit IS DISTINCT FROM NEW.reserve_account_id) THEN
    RAISE EXCEPTION 'OxSteed Credit funding record does not match its ledger transaction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_partner_funding_guard ON oxsteed_credit_partner_funding_records;
CREATE TRIGGER oxsteed_credit_partner_funding_guard
  BEFORE INSERT OR UPDATE OF partner_ledger_id, partner_id, reserve_account_id,
    transaction_id, direction, currency_code
  ON oxsteed_credit_partner_funding_records
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_partner_funding();

CREATE OR REPLACE RULE oxsteed_credit_partner_funding_no_update AS
  ON UPDATE TO oxsteed_credit_partner_funding_records DO INSTEAD NOTHING;
CREATE OR REPLACE RULE oxsteed_credit_partner_funding_no_delete AS
  ON DELETE TO oxsteed_credit_partner_funding_records DO INSTEAD NOTHING;

-- Extend the database direction guard for reserve movements. The earlier
-- migration intentionally rejected these types while the supporting flow was
-- absent; this is the audited flow that makes them postable.
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
      AND CASE NEW.metadata->>'direction'
        WHEN 'credit' THEN debit_type = 'platform_treasury' AND credit_type = 'customer_wallet'
        WHEN 'debit' THEN debit_type = 'customer_wallet' AND credit_type = 'platform_treasury'
        ELSE FALSE END;
  ELSIF NEW.transaction_type = 'funding' THEN
    expected_direction_valid := debit_type = 'platform_treasury' AND credit_type = 'partner_reserve'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'reserve_release' THEN
    expected_direction_valid := debit_type = 'partner_reserve' AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NOT NULL AND NEW.agreement_id IS NULL;
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

-- Keep partner funding tied to the reserve account named by the partner ledger.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_partner_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_partner_id BIGINT;
  credit_partner_id BIGINT;
  agreement_partner_id BIGINT;
  ledger_reserve_id BIGINT;
BEGIN
  SELECT partner_id INTO debit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.debit_account_id;
  SELECT partner_id INTO credit_partner_id FROM oxsteed_credit_accounts WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type IN ('purchase', 'refund', 'settlement') THEN
    IF NEW.partner_id IS NULL OR NEW.agreement_id IS NULL THEN
      RAISE EXCEPTION 'OxSteed Credit restaurant movements require a partner and agreement' USING ERRCODE = '23514';
    END IF;
    SELECT partner_id INTO agreement_partner_id FROM oxsteed_credit_partner_agreements WHERE id = NEW.agreement_id;
    IF agreement_partner_id IS NULL OR agreement_partner_id IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION 'OxSteed Credit movement partner does not match its agreement' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.transaction_type IN ('funding', 'reserve_release') THEN
    IF NEW.partner_id IS NULL OR NEW.agreement_id IS NOT NULL THEN
      RAISE EXCEPTION 'OxSteed Credit funding movement requires only a partner' USING ERRCODE = '23514';
    END IF;
    SELECT reserve_account_id INTO ledger_reserve_id
      FROM oxsteed_credit_partner_ledgers WHERE partner_id = NEW.partner_id;
    IF ledger_reserve_id IS NULL
       OR (NEW.transaction_type = 'funding' AND NEW.credit_account_id IS DISTINCT FROM ledger_reserve_id)
       OR (NEW.transaction_type = 'reserve_release' AND NEW.debit_account_id IS DISTINCT FROM ledger_reserve_id) THEN
      RAISE EXCEPTION 'OxSteed Credit funding movement does not match its partner reserve' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.transaction_type = 'purchase' AND credit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit purchase payable account does not match its partner' USING ERRCODE = '23514';
  ELSIF NEW.transaction_type = 'refund' AND debit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit refund payable account does not match its partner' USING ERRCODE = '23514';
  ELSIF NEW.transaction_type = 'settlement' AND debit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit settlement payable account does not match its partner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
