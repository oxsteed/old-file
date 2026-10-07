-- Migration 726: guest Credit spend tracking (locked decision #1).
--
-- Guest Credit is platform-funded promotional spend (platform_treasury →
-- partner_payable). Each guest session is bound to a fingerprint and
-- subject to strict caps: $25/ticket, $50/day, $200/lifetime.
-- This table tracks per-session spend for daily/lifetime enforcement.

CREATE TABLE IF NOT EXISTS credit_guest_spend_tracking (
  id BIGSERIAL PRIMARY KEY,
  session_fingerprint TEXT NOT NULL,
  spend_date DATE NOT NULL DEFAULT CURRENT_DATE,
  daily_spent_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_spent_cents >= 0),
  lifetime_spent_cents BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_spent_cents >= 0),
  last_spend_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_fingerprint, spend_date)
);

CREATE INDEX IF NOT EXISTS idx_credit_guest_spend_fingerprint
  ON credit_guest_spend_tracking (session_fingerprint);
CREATE INDEX IF NOT EXISTS idx_credit_guest_spend_date
  ON credit_guest_spend_tracking (spend_date);
