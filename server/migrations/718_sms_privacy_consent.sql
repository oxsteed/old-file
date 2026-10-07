-- Migration 718: SMS privacy (hash + redacted preview) and STOP consent (opt-out list)
--
-- ITEM 9: sms_logs.message_body previously carried the full message text.
-- New rows store only a SHA-256 hash (message_hash) and a redacted preview
-- (message_preview, first 20 chars). message_body is retained as a column for
-- backward compatibility but new writes use the constant '[redacted]'.
-- Pre-existing rows may still contain full bodies; see the migration notes in
-- docs/ for the recommended scrub job (no data-destroying DDL is run here).
--
-- ITEM 10: direct (guest) SMS sends now go through a governor that honors
-- carrier-style STOP opt-outs recorded in sms_opt_outs and enforces a per-phone
-- rate limit. user_id is relaxed to nullable so guest sends can be logged for
-- that rate limit without a user account.

ALTER TABLE sms_logs
  ADD COLUMN IF NOT EXISTS message_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS message_preview VARCHAR(60);

-- Allow guest sends (no user account) to be logged for audit + rate limiting.
ALTER TABLE sms_logs
  ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  -- Digits-only normalized phone number (e.g. '15551234567').
  phone_number VARCHAR(20) PRIMARY KEY,
  -- Where the opt-out came from: 'twilio_stop_webhook', 'support', 'api', ...
  source VARCHAR(50) NOT NULL DEFAULT 'api',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_created_at
  ON sms_opt_outs (created_at DESC);
