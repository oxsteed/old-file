-- Migration 519: avoid the event_type column/variable name collision in the
-- hold notification trigger introduced by migration 506.

CREATE OR REPLACE FUNCTION enqueue_oxsteed_credit_hold_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  notification_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    notification_event_type := 'hold_created';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    notification_event_type := CASE NEW.status
      WHEN 'captured' THEN 'hold_captured'
      WHEN 'released' THEN 'hold_released'
      WHEN 'expired' THEN 'hold_expired'
      ELSE NULL
    END;
  END IF;

  IF notification_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO oxsteed_credit_notification_outbox
    (hold_id, user_id, event_type, payload)
  VALUES (
    NEW.id,
    NEW.customer_id,
    notification_event_type,
    jsonb_build_object(
      'eventType', notification_event_type,
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
