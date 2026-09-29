-- Migration 593: durable idempotency for public QR checkout attempts.
-- The request key is scoped to one QR code so a retry replays the same
-- checkout without preventing a later legitimate payment on another code.

ALTER TABLE qr_payments
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_payments_client_request
  ON qr_payments (qr_code_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
