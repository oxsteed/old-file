-- Growth Center (Promote) attribution decisions 1-3. Additive.
--  1. Net conversions: a conversion is marked reversed (reversed_at,
--     reversal_reason) when its booking, appointment, order or job is later
--     cancelled or refunded. Gross = all conversions, net = not reversed.
--     Reversal runs from triggers on the source tables so every path (customer,
--     staff, admin, webhook) is covered. The conversion row still stores no
--     reference id: the trigger recomputes the same hashed dedupe key.
--  2. Marketplace job hires are a conversion type ('job').
--  3. account_key: for a signed-in visitor WITHOUT analytics consent, a
--     per-owner hash of the account id on the visit row, used only to link a
--     later conversion by the same signed-in account. It is cleared after the
--     7-day attribution window by the daily retention job.
ALTER TABLE promotion_link_events
  ADD COLUMN IF NOT EXISTS account_key TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE promotion_link_events DROP CONSTRAINT IF EXISTS promotion_link_events_conversion_check;
ALTER TABLE promotion_link_events ADD CONSTRAINT promotion_link_events_conversion_check CHECK (
  (event_type = 'conversion' AND conversion_type IN ('booking', 'appointment', 'order', 'job') AND dedupe_key IS NOT NULL
     AND account_key IS NULL)
  OR (event_type <> 'conversion' AND conversion_type IS NULL AND attributed_visit_id IS NULL
     AND reversed_at IS NULL AND reversal_reason IS NULL));

DO $$ BEGIN
  ALTER TABLE promotion_link_events ADD CONSTRAINT promotion_link_events_reversal_check CHECK (
    (reversed_at IS NULL AND reversal_reason IS NULL)
    OR (reversed_at IS NOT NULL AND reversal_reason IN ('cancelled', 'refunded')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE promotion_link_events ADD CONSTRAINT promotion_link_events_account_key_check CHECK (
    account_key IS NULL OR (event_type = 'visit' AND account_key ~ '^[0-9a-f]{64}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS promotion_link_events_visit_account
  ON promotion_link_events(account_key, occurred_at DESC) WHERE event_type = 'visit' AND account_key IS NOT NULL;

-- Marks the conversion for (conversion type, source row id) reversed. Never
-- raises: analytics must not block a cancellation or refund.
CREATE OR REPLACE FUNCTION promotion_conversion_reverse() RETURNS trigger AS $$
DECLARE
  reason TEXT := CASE WHEN NEW.status::TEXT IN ('cancelled', 'accepted_cancelled') THEN 'cancelled' ELSE 'refunded' END;
BEGIN
  BEGIN
    UPDATE promotion_link_events
       SET reversed_at = NOW(), reversal_reason = reason
     WHERE dedupe_key = 'conversion:' || encode(sha256(convert_to(TG_ARGV[0] || ':' || NEW.id::TEXT, 'UTF8')), 'hex')
       AND event_type = 'conversion' AND reversed_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'promotion conversion reversal skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS promotion_conversion_reverse_booking ON booking_requests;
CREATE TRIGGER promotion_conversion_reverse_booking
  AFTER UPDATE OF status, payment_status, refunded_at ON booking_requests
  FOR EACH ROW WHEN (
    (NEW.status::TEXT IN ('cancelled', 'accepted_cancelled') AND OLD.status::TEXT IS DISTINCT FROM NEW.status::TEXT)
    OR (NEW.payment_status::TEXT = 'refunded' AND OLD.payment_status::TEXT IS DISTINCT FROM 'refunded')
    OR (NEW.refunded_at IS NOT NULL AND OLD.refunded_at IS NULL))
  EXECUTE FUNCTION promotion_conversion_reverse('booking');

DROP TRIGGER IF EXISTS promotion_conversion_reverse_appointment ON business_appointments;
CREATE TRIGGER promotion_conversion_reverse_appointment
  AFTER UPDATE OF status, payment_status ON business_appointments
  FOR EACH ROW WHEN (
    (NEW.status::TEXT = 'cancelled' AND OLD.status::TEXT IS DISTINCT FROM 'cancelled')
    OR (NEW.payment_status::TEXT = 'refunded' AND OLD.payment_status::TEXT IS DISTINCT FROM 'refunded'))
  EXECUTE FUNCTION promotion_conversion_reverse('appointment');

DROP TRIGGER IF EXISTS promotion_conversion_reverse_order ON food_orders;
CREATE TRIGGER promotion_conversion_reverse_order
  AFTER UPDATE OF status, payment_status, refunded_at ON food_orders
  FOR EACH ROW WHEN (
    (NEW.status::TEXT IN ('cancelled', 'refunded') AND OLD.status::TEXT IS DISTINCT FROM NEW.status::TEXT)
    OR (NEW.payment_status::TEXT = 'refunded' AND OLD.payment_status::TEXT IS DISTINCT FROM 'refunded')
    OR (NEW.refunded_at IS NOT NULL AND OLD.refunded_at IS NULL))
  EXECUTE FUNCTION promotion_conversion_reverse('order');

DROP TRIGGER IF EXISTS promotion_conversion_reverse_job ON jobs;
CREATE TRIGGER promotion_conversion_reverse_job
  AFTER UPDATE OF status ON jobs
  FOR EACH ROW WHEN (NEW.status::TEXT = 'cancelled' AND OLD.status::TEXT IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION promotion_conversion_reverse('job');
