-- Migration 506: durable notifications for OxSteed Credit authorization holds.
--
-- Hold state changes are committed with the hold itself. A database trigger
-- covers customer actions, scheduled expiry, and automatic safety releases so
-- no lifecycle path can silently skip the customer-facing event.

ALTER TABLE oxsteed_credit_notification_outbox
  ALTER COLUMN transaction_id DROP NOT NULL;

ALTER TABLE oxsteed_credit_notification_outbox
  ADD COLUMN IF NOT EXISTS hold_id UUID REFERENCES oxsteed_credit_holds(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'oxsteed_credit_notification_outbox_source_check'
  ) THEN
    ALTER TABLE oxsteed_credit_notification_outbox
      ADD CONSTRAINT oxsteed_credit_notification_outbox_source_check
      CHECK ((transaction_id IS NULL) <> (hold_id IS NULL));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_hold_notification
  ON oxsteed_credit_notification_outbox (hold_id, user_id, event_type)
  WHERE hold_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_notification_outbox_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.hold_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM oxsteed_credit_holds h
       WHERE h.id = NEW.hold_id
         AND h.customer_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Credit hold notification recipient does not own the hold'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM oxsteed_credit_transactions t
      JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
      JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
     WHERE t.id = NEW.transaction_id
       AND (
         (debit_account.account_type = 'customer_wallet' AND debit_account.customer_id = NEW.user_id)
         OR (credit_account.account_type = 'customer_wallet' AND credit_account.customer_id = NEW.user_id)
       )
  ) THEN
    RAISE EXCEPTION 'Credit transaction notification recipient is not a wallet owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_notification_outbox_source_guard ON oxsteed_credit_notification_outbox;

CREATE TRIGGER oxsteed_credit_notification_outbox_source_guard
  BEFORE INSERT OR UPDATE OF transaction_id, hold_id, user_id
  ON oxsteed_credit_notification_outbox
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_notification_outbox_source();

CREATE OR REPLACE FUNCTION enqueue_oxsteed_credit_hold_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    event_type := 'hold_created';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    event_type := CASE NEW.status
      WHEN 'captured' THEN 'hold_captured'
      WHEN 'released' THEN 'hold_released'
      WHEN 'expired' THEN 'hold_expired'
      ELSE NULL
    END;
  END IF;

  IF event_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO oxsteed_credit_notification_outbox
    (hold_id, user_id, event_type, payload)
  VALUES (
    NEW.id,
    NEW.customer_id,
    event_type,
    jsonb_build_object(
      'eventType', event_type,
      'holdId', NEW.id::TEXT,
      'status', NEW.status,
      'amountCents', NEW.amount_cents,
      'currencyCode', NEW.currency_code,
      'partnerId', NEW.partner_id::TEXT,
      'referenceType', NEW.reference_type,
      'referenceId', NEW.reference_id,
      'expiresAt', NEW.expires_at
    )
  )
  ON CONFLICT (hold_id, user_id, event_type) WHERE hold_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_notification_outbox_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_notification_outbox_guard
  AFTER INSERT OR UPDATE OF status
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_oxsteed_credit_hold_notification();
