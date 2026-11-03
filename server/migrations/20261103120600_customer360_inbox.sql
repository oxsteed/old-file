-- Customer 360 upgrade 8: unified inbox. Support replies and in-app
-- messages keep using their existing tables and endpoints; this records the
-- email and SMS messages staff send from the workspace (each one an explicit,
-- audited admin action) and gives customers an opt-out for support SMS.

CREATE TABLE IF NOT EXISTS customer_outbound_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID         NOT NULL,
  admin_id           UUID         NOT NULL,
  channel            VARCHAR(10)  NOT NULL CHECK (channel IN ('email', 'sms')),
  template_key       VARCHAR(60),
  language           VARCHAR(5)   NOT NULL CHECK (language IN ('en', 'es', 'fr', 'ht', 'ar')),
  subject            VARCHAR(200),
  -- Email bodies are kept (they are correspondence, like support messages).
  -- SMS bodies follow the sms_logs rule: hash and short preview only.
  body               TEXT,
  body_hash          CHAR(64)     NOT NULL,
  body_preview       VARCHAR(40)  NOT NULL,
  recipient_masked   VARCHAR(80)  NOT NULL,
  status             VARCHAR(12)  NOT NULL CHECK (status IN ('queued', 'sent', 'not_sent')),
  status_reason      VARCHAR(60),
  outbox_id          UUID,
  client_message_id  UUID         NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_outbound_messages_body_rule CHECK (
    (channel = 'email' AND body IS NOT NULL AND subject IS NOT NULL) OR (channel = 'sms' AND body IS NULL)),
  CONSTRAINT customer_outbound_messages_idempotent UNIQUE (admin_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS customer_outbound_messages_customer_idx
  ON customer_outbound_messages (customer_id, created_at DESC);

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS sms_support_replies BOOLEAN DEFAULT TRUE;
