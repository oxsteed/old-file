-- Migration 505: durable customer notifications for OxSteed Credit activity.
--
-- The ledger transaction and its notification intent are committed together.
-- Delivery is intentionally asynchronous so provider outages never block a
-- balance change and worker restarts cannot lose the customer-facing event.

CREATE TABLE IF NOT EXISTS oxsteed_credit_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES oxsteed_credit_transactions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type VARCHAR(60) NOT NULL DEFAULT 'transaction_posted',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, user_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_due
  ON oxsteed_credit_notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_user
  ON oxsteed_credit_notification_outbox (user_id, created_at DESC);
