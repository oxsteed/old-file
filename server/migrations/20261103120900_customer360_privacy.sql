-- Customer 360 upgrade 11: erasure of messages sent from the Customer 360
-- inbox. Erased rows keep the send record (channel, time, status, body hash)
-- for the audit trail but lose subject, body and recipient.
ALTER TABLE customer_outbound_messages ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ;
ALTER TABLE customer_outbound_messages DROP CONSTRAINT IF EXISTS customer_outbound_messages_body_rule;
ALTER TABLE customer_outbound_messages ADD CONSTRAINT customer_outbound_messages_body_rule CHECK (
  (erased_at IS NOT NULL AND body IS NULL AND subject IS NULL)
  OR (erased_at IS NULL AND ((channel = 'email' AND body IS NOT NULL AND subject IS NOT NULL) OR (channel = 'sms' AND body IS NULL))));
