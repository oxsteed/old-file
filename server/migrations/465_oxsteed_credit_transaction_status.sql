-- Migration 465: keep Credit transaction state aligned with journal entries.
--
-- Only posted transactions may have journal entries. Posting and reversal
-- timestamps are required evidence for their corresponding terminal state.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'posted' AND NEW.posted_at IS NULL THEN
    RAISE EXCEPTION 'A posted OxSteed Credit transaction requires a posted timestamp'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'reversed' AND NEW.reversed_at IS NULL THEN
    RAISE EXCEPTION 'A reversed OxSteed Credit transaction requires a reversed timestamp'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('pending', 'voided')
     AND (NEW.posted_at IS NOT NULL OR NEW.reversed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A pending or voided OxSteed Credit transaction cannot carry posting evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_status_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_status_guard
  BEFORE INSERT OR UPDATE OF status, posted_at, reversed_at
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_status();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_posted_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_status VARCHAR(20);
BEGIN
  SELECT status INTO transaction_status
    FROM oxsteed_credit_transactions
   WHERE id = NEW.transaction_id;

  IF transaction_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'OxSteed Credit journal entries require a posted transaction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_posted_entry_guard ON oxsteed_credit_transaction_entries;

CREATE CONSTRAINT TRIGGER oxsteed_credit_posted_entry_guard
  AFTER INSERT
  ON oxsteed_credit_transaction_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_posted_entry();
