-- Credit redesign checkpoint 3 (D-798/D-799/D-800/D-804): closed-loop
-- 16-digit OxSteed cards.
--
-- New cards mint a 16-digit number (OxSteed-owned prefix 9700, Luhn
-- check digit) instead of a random base64 token. The number is stored
-- encrypted (AES-256-GCM, server/utils/encryption.js) so the owner can
-- reveal it after step-up; the credential hash stays the spend lookup.
-- The 3-digit security code is hashed with a per-card scrypt salt and
-- can only be reset, never read back. Daily and per-order-type spend
-- limits are NULL when unset (no cap).
ALTER TABLE oxsteed_credit_cards
  ADD COLUMN IF NOT EXISTS credential_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS security_code_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS security_code_salt VARCHAR(32),
  ADD COLUMN IF NOT EXISTS daily_limit_cents BIGINT,
  ADD COLUMN IF NOT EXISTS merchant_type_limits JSONB;

-- A set daily limit must be positive; zero would silently block the card.
ALTER TABLE oxsteed_credit_cards
  ADD CONSTRAINT oxsteed_credit_cards_daily_limit_positive
  CHECK (daily_limit_cents IS NULL OR daily_limit_cents > 0);
