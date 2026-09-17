-- Migration 530: OxSteed Credit card ecosystem foundation.
--
-- Adds a card credential layer on top of the existing OxSteed Credit ledger.
-- A card (virtual or physical) is never a new value store -- it is an
-- alternate, revocable credential that resolves to an existing
-- oxsteed_credit_accounts customer_wallet row, the same way a QR session
-- resolves to a restaurant wallet today. Only a salted hash of the raw
-- credential and PIN are ever persisted; raw values are returned to the
-- caller exactly once at issuance/activation time and are not recoverable.
--
-- Also introduces the 'cash_out' ledger transaction type so a customer can
-- convert OxSteed Credit back into physical cash at an operator-controlled
-- kiosk, and extends the existing restaurant device-pairing infrastructure
-- (restaurant_app_devices) with a 'credit_kiosk' app so cash-out/redemption
-- hardware reuses the same device-token authentication as POS/Kitchen/Display
-- instead of inventing a parallel device model.

BEGIN;

-- 1. Allow the ledger to record a cash-out movement (mirror of 'load': value
--    leaves the customer_wallet and returns to platform_treasury).
ALTER TABLE oxsteed_credit_transactions
  DROP CONSTRAINT IF EXISTS oxsteed_credit_transactions_transaction_type_check;

ALTER TABLE oxsteed_credit_transactions
  ADD CONSTRAINT oxsteed_credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement',
    'settlement_reversal', 'fee', 'expiration', 'chargeback', 'funding',
    'reserve_release', 'conversion_debit', 'conversion_fee', 'conversion_credit',
    'cash_out'
  ));

-- 2. Let a physical cash-out/redemption kiosk pair using the same
--    restaurant_app_devices flow already used by POS/Kitchen/Display.
ALTER TABLE restaurant_app_devices
  DROP CONSTRAINT IF EXISTS restaurant_app_devices_app_key_check;

ALTER TABLE restaurant_app_devices
  ADD CONSTRAINT restaurant_app_devices_app_key_check
  CHECK (app_key IN ('manager','pos','kitchen','display','inventory','crew','runner','restaurant','credit_kiosk'));

-- 3. Card records. One customer may hold multiple cards (e.g. one virtual +
--    one physical); each card is scoped to a single OxSteed Credit account.
CREATE TABLE IF NOT EXISTS oxsteed_credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES oxsteed_credit_accounts(id) ON DELETE RESTRICT,
  card_type VARCHAR(16) NOT NULL CHECK (card_type IN ('virtual', 'physical')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'frozen', 'lost', 'stolen', 'revoked', 'expired')),
  fulfillment_status VARCHAR(20) NOT NULL DEFAULT 'not_applicable'
    CHECK (fulfillment_status IN ('not_applicable', 'pending', 'printed', 'shipped', 'delivered')),
  credential_hash CHAR(64) UNIQUE,
  credential_last4 VARCHAR(8),
  activation_code_hash CHAR(64),
  activation_code_expires_at TIMESTAMPTZ,
  pin_hash CHAR(64),
  pin_salt VARCHAR(32),
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_pin_attempts >= 0),
  pin_locked_until TIMESTAMPTZ,
  nickname VARCHAR(80),
  shipping_address JSONB,
  replaces_card_id UUID REFERENCES oxsteed_credit_cards(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(160) UNIQUE,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  frozen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A card with a minted credential must carry its display fragment, and vice versa.
  CHECK ((credential_hash IS NULL) = (credential_last4 IS NULL)),
  -- Only an active card may carry a working PIN pair.
  CHECK ((pin_hash IS NULL) = (pin_salt IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_cards_customer
  ON oxsteed_credit_cards(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_cards_account
  ON oxsteed_credit_cards(account_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oxsteed_credit_cards_idempotency
  ON oxsteed_credit_cards(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION set_oxsteed_credit_cards_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_cards_set_updated_at ON oxsteed_credit_cards;
CREATE TRIGGER oxsteed_credit_cards_set_updated_at
  BEFORE UPDATE ON oxsteed_credit_cards
  FOR EACH ROW
  EXECUTE FUNCTION set_oxsteed_credit_cards_updated_at();

-- 4. If the owning customer's OxSteed Credit account is closed, every card
--    tied to it must stop being usable, mirroring migration 485's
--    restaurant-status propagation into Credit partners.
CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_account_status_to_cards()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  UPDATE oxsteed_credit_cards
     SET status = 'revoked',
         revoked_at = NOW(),
         updated_at = NOW()
   WHERE account_id = NEW.id
     AND status IN ('pending', 'active', 'frozen');

  INSERT INTO oxsteed_credit_audit_events
    (action_type, resource_type, resource_id, reason, after_state, metadata)
  SELECT 'credit.card.account_status_propagated', 'credit_card', id::TEXT,
         'Card revoked because its OxSteed Credit account is no longer active',
         jsonb_build_object('status', 'revoked', 'accountStatus', NEW.status),
         jsonb_build_object('source', 'database_account_status_guard')
    FROM oxsteed_credit_cards
   WHERE account_id = NEW.id
     AND status = 'revoked'
     AND revoked_at >= NOW() - INTERVAL '5 seconds';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_account_status_guard_cards ON oxsteed_credit_accounts;
CREATE TRIGGER oxsteed_credit_account_status_guard_cards
  AFTER UPDATE OF status
  ON oxsteed_credit_accounts
  FOR EACH ROW
  WHEN (NEW.account_type = 'customer_wallet')
  EXECUTE FUNCTION propagate_oxsteed_credit_account_status_to_cards();

COMMIT;
