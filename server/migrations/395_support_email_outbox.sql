-- Durable retry queue for customer-facing support email notifications.
-- The provider idempotency key prevents duplicate delivery when a worker
-- crashes after Resend accepts a request but before the row is marked sent.
CREATE TABLE IF NOT EXISTS support_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES support_conversations(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_email_outbox_due
  ON support_email_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'sending');

