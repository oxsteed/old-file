-- Migration 433: protect OxSteed Credit financial identities.
--
-- A partner, agreement, or account becomes part of the financial history as
-- soon as it is referenced by a ledger movement, hold, settlement, or
-- entitlement. Changing its identity afterward would make old records point
-- at a different currency, customer, restaurant, or partner.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_account_identity_stability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_history BOOLEAN;
BEGIN
  IF NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
    SELECT EXISTS (
      SELECT 1 FROM oxsteed_credit_transaction_entries e
       WHERE e.account_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_transactions t
       WHERE t.debit_account_id = OLD.id OR t.credit_account_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_holds h
       WHERE h.account_id = OLD.id
    )
    INTO has_history;

    IF has_history THEN
      RAISE EXCEPTION 'OxSteed Credit account identity cannot change after financial activity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_account_identity_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_account_identity_guard
  BEFORE UPDATE OF account_type, customer_id, partner_id, currency_code
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_account_identity_stability();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_partner_identity_stability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_history BOOLEAN;
BEGIN
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.settlement_currency_code IS DISTINCT FROM OLD.settlement_currency_code THEN
    SELECT EXISTS (
      SELECT 1 FROM oxsteed_credit_partner_agreements a
       WHERE a.partner_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_accounts a
       WHERE a.partner_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_transactions t
       WHERE t.partner_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_holds h
       WHERE h.partner_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_settlements s
       WHERE s.partner_id = OLD.id
    )
    INTO has_history;

    IF has_history THEN
      RAISE EXCEPTION 'OxSteed Credit partner identity cannot change after financial activity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_partner_identity_guard ON oxsteed_credit_partners;

CREATE TRIGGER oxsteed_credit_partner_identity_guard
  BEFORE UPDATE OF restaurant_id, settlement_currency_code
  ON oxsteed_credit_partners
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_partner_identity_stability();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_agreement_identity_stability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_history BOOLEAN;
BEGIN
  IF NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    SELECT EXISTS (
      SELECT 1 FROM oxsteed_credit_customer_entitlements e
       WHERE e.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_transactions t
       WHERE t.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_holds h
       WHERE h.agreement_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM oxsteed_credit_settlements s
       WHERE s.agreement_id = OLD.id
    )
    INTO has_history;

    IF has_history THEN
      RAISE EXCEPTION 'OxSteed Credit agreement partner cannot change after financial activity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_identity_guard ON oxsteed_credit_partner_agreements;

CREATE TRIGGER oxsteed_credit_agreement_identity_guard
  BEFORE UPDATE OF partner_id
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_agreement_identity_stability();
