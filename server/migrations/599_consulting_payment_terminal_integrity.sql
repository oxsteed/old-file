-- Migration 599: prevent consulting payments from leaving terminal states.
-- Provider refunds are recorded by the owning controller only after exact
-- provider settlement; this trigger prevents unrelated status resurrection.

CREATE OR REPLACE FUNCTION enforce_consulting_payment_terminal_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'refunded' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'Refunded consulting payments cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'completed' AND NEW.status NOT IN ('completed', 'refunded') THEN
    RAISE EXCEPTION 'Completed consulting payments may only remain completed or become refunded'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consulting_payment_terminal_integrity_guard ON consulting_payments;
CREATE TRIGGER consulting_payment_terminal_integrity_guard
  BEFORE UPDATE OF status ON consulting_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_consulting_payment_terminal_integrity();
