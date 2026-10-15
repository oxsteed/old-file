-- 880_logistics_stripe_webhook_events.sql
-- Phase 3 (logistics refactor): Stripe webhook deduplication ledger for
-- logistics payments.
--
-- Every logistics-relevant Stripe event is claimed here inside the same
-- transaction that applies it, keyed on the Stripe event id (UNIQUE).
-- A duplicate or retried delivery conflicts on stripe_event_id and is
-- skipped before any money state changes, so out-of-order and repeated
-- webhooks are safe. The global webhook_event_receipts table still guards
-- the shared endpoint; this table is the logistics settlement guard.

CREATE TABLE IF NOT EXISTS logistics_stripe_webhook_events (
  id                 SERIAL PRIMARY KEY,
  stripe_event_id    TEXT NOT NULL UNIQUE,
  event_type         TEXT NOT NULL,
  payment_attempt_id INTEGER REFERENCES logistics_payment_attempts(id) ON DELETE SET NULL,
  payload_hash       TEXT,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_webhook_events_attempt
  ON logistics_stripe_webhook_events(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_logistics_webhook_events_type
  ON logistics_stripe_webhook_events(event_type, processed_at DESC);
