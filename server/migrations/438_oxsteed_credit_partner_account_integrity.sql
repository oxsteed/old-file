-- Keep restaurant-facing credit movements tied to the payable account named by
-- the partner and agreement, even when a maintenance path writes directly.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_partner_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_partner_id BIGINT;
  credit_partner_id BIGINT;
  agreement_partner_id BIGINT;
BEGIN
  SELECT partner_id INTO debit_partner_id
    FROM oxsteed_credit_accounts
   WHERE id = NEW.debit_account_id;
  SELECT partner_id INTO credit_partner_id
    FROM oxsteed_credit_accounts
   WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type IN ('purchase', 'refund', 'settlement') THEN
    IF NEW.partner_id IS NULL OR NEW.agreement_id IS NULL THEN
      RAISE EXCEPTION 'OxSteed Credit restaurant movements require a partner and agreement'
        USING ERRCODE = '23514';
    END IF;

    SELECT partner_id INTO agreement_partner_id
      FROM oxsteed_credit_partner_agreements
     WHERE id = NEW.agreement_id;

    IF agreement_partner_id IS NULL OR agreement_partner_id IS DISTINCT FROM NEW.partner_id THEN
      RAISE EXCEPTION 'OxSteed Credit movement partner does not match its agreement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.transaction_type = 'purchase'
     AND credit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit purchase payable account does not match its partner'
      USING ERRCODE = '23514';
  ELSIF NEW.transaction_type = 'refund'
     AND debit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit refund payable account does not match its partner'
      USING ERRCODE = '23514';
  ELSIF NEW.transaction_type = 'settlement'
     AND debit_partner_id IS DISTINCT FROM NEW.partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit settlement payable account does not match its partner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_partner_account_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_partner_account_guard
  BEFORE INSERT OR UPDATE OF transaction_type, debit_account_id, credit_account_id,
    partner_id, agreement_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_partner_account();
