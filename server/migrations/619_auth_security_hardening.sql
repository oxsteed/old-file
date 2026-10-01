-- Migration 619: auth security hardening (audit workstream 1).
--
-- 1. M1 — password-reset tokens were stored in plaintext. Hash every existing
--    token with SHA-256 (pgcrypto is already enabled by migration 406). The
--    server hashes the presented token before comparison, so reset links
--    emailed before this deploy keep working.
-- 2. H10 — per-account login lockout columns + OTP resend cooldown column.
-- 3. H8b — one-time impersonation exchange-code columns on
--    user_impersonation_log (server patch in the workstream report wires the
--    issuance/exchange endpoints; the columns land here so deploy order is
--    safe either way).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── M1: hash stored password-reset tokens ────────────────────────────────
-- Every row written before this migration holds a plaintext token, so a
-- blanket re-hash is exactly right: presented token T is hashed server-side
-- and compared against sha256(T).
UPDATE users
   SET reset_token = encode(digest(reset_token, 'sha256'), 'hex')
 WHERE reset_token IS NOT NULL
   AND reset_token <> '';

-- ── H10: per-account login lockout + OTP send cooldown ───────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS login_locked_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_last_sent_at      TIMESTAMPTZ;

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS otp_last_sent_at TIMESTAMPTZ;

-- ── H8b: one-time impersonation exchange codes ───────────────────────────
-- impersonateUser will store only the SHA-256 of a short-lived,
-- single-use exchange code (never the JWT). The /impersonate page swaps the
-- code for the JWT via an authenticated POST; used/expired codes are
-- rejected. Columns are nullable so older rows are unaffected.
ALTER TABLE user_impersonation_log
  ADD COLUMN IF NOT EXISTS exchange_code_hash       TEXT,
  ADD COLUMN IF NOT EXISTS exchange_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exchange_code_used_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_impersonation_exchange_code
  ON user_impersonation_log (exchange_code_hash)
  WHERE exchange_code_hash IS NOT NULL;
