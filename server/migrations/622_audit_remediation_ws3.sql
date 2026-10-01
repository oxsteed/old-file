-- Migration 622: audit remediation (Workstream 3: injection, input validation, QR).
--
-- 1. M6 (SSRF via business webhook registration):
--    business_webhooks.pinned_ip stores the resolved public IP captured at
--    registration time. Delivery-time code re-resolves the hostname and
--    requires a public IP on every attempt; the pinned value is used for
--    DNS-change detection and audit.
-- 2. M7 (consulting payment duplicate guard):
--    partial unique index makes the "one live payment per scheduled session"
--    guard atomic: only one row with status pending/processing may exist per
--    session_scheduled_id. The INSERT in createPaymentIntent uses
--    ON CONFLICT (session_scheduled_id) WHERE ... DO NOTHING against this
--    index, and Stripe gets a deterministic idempotency key
--    consulting:{scheduledId}:{packageId}.

ALTER TABLE business_webhooks
  ADD COLUMN IF NOT EXISTS pinned_ip INET;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consulting_payments_active_session
  ON consulting_payments (session_scheduled_id)
  WHERE status IN ('pending', 'processing');
