-- Migration 99911: TOTP step-up for admin credit money actions (auth-audit item 12).
-- The admin credit dual-approval path previously proved "fresh step-up" with
-- an emailed 6-digit code, so the second factor was only as strong as the
-- admin's email account. Per the product decision, the admin credit
-- step-up action types now verify against the admin's TOTP authenticator
-- instead of an emailed code.
--
--   * oxsteed_credit_stepup_challenges.method ('email' | 'totp'): TOTP
--     challenges store no code_hash (NULL) because there is no emailed code;
--     verification checks the presented code against the actor's TOTP
--     secret at verify time.
--   * admin_totp_stepup_counters: replay guard. TOTP codes are valid for a
--     30-second window, so a code could otherwise be presented twice against
--     two different challenges. Each admin may consume at most one TOTP
--     step-up per 30-second time-step; the max consumed counter is stored
--     here and a code from an already-consumed step is rejected.
ALTER TABLE oxsteed_credit_stepup_challenges
  ADD COLUMN IF NOT EXISTS method VARCHAR(8) NOT NULL DEFAULT 'email'
  CHECK (method IN ('email', 'totp'));
ALTER TABLE oxsteed_credit_stepup_challenges
  ALTER COLUMN code_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS admin_totp_stepup_counters (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_counter BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
