-- 831_chat_payment_request_expiry.sql
-- Review P2-10-F01 (open-forever half): chat_payment_requests never expired,
-- so an abandoned request card could be paid or POP-confirmed arbitrarily
-- far in the future. Add an expires_at TTL (set at creation; default 72h via
-- CHAT_PAYMENT_REQUEST_TTL_HOURS) and an 'expired' terminal status swept by
-- the chatPaymentRequestExpirySweeper. Pay/confirm paths also enforce the
-- expiry inline so a past-expiry request cannot settle before the sweep runs.

ALTER TABLE chat_payment_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill: requests created before this migration expire 72h after creation.
-- Already-abandoned rows land in the past and are swept to 'expired'.
UPDATE chat_payment_requests
   SET expires_at = created_at + INTERVAL '72 hours'
 WHERE expires_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_payment_requests_status_check'
  ) THEN
    ALTER TABLE chat_payment_requests DROP CONSTRAINT chat_payment_requests_status_check;
  END IF;
END $$;

ALTER TABLE chat_payment_requests
  ADD CONSTRAINT chat_payment_requests_status_check
  CHECK (status IN ('open', 'paid', 'cancelled', 'refunded', 'expired'));

CREATE INDEX IF NOT EXISTS idx_cpr_expiry
  ON chat_payment_requests (expires_at)
  WHERE status = 'open';
