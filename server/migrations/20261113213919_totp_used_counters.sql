-- Migration: shared TOTP replay guard (Domain 6 auth finding #7).
--
-- A TOTP code stays valid for its 30-second step, so the same code could
-- previously verify at every channel (login 2FA, fresh-auth mint, TOTP
-- setup/verify, payout-method step-up, card security, growth approvals)
-- until the step rolled over. Only the admin credit step-up recorded the
-- used counter (admin_totp_stepup_counters, migration 99911).
--
-- totp_used_counters is the shared per-user record: one row per user
-- holding the highest consumed time-step counter. Every verify site
-- consumes the current counter after a successful verification (see
-- server/services/totpReplayGuard.js); a second presentation in the
-- same step finds the counter already consumed and is rejected.
-- The upsert is a single atomic statement, so concurrent verifications
-- of the same code serialize on the row instead of both succeeding.
--
-- The admin step-up counters are carried over so no code consumed
-- before this migration becomes reusable, and the old table is dropped
-- (verifyTotpPresentation now uses the shared guard).
CREATE TABLE IF NOT EXISTS totp_used_counters (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_counter BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO totp_used_counters (user_id, max_counter, updated_at)
SELECT user_id, max_counter, updated_at FROM admin_totp_stepup_counters
ON CONFLICT (user_id) DO NOTHING;

DROP TABLE IF EXISTS admin_totp_stepup_counters;
