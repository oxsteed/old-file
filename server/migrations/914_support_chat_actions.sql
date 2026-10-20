-- Migration 914: AI support chat in-chat actions.
--
-- The assistant may PROPOSE a small set of safe actions (reopen or reply to
-- the user's own ticket, resend the email verification, navigate to one of
-- the user's records, cancel the user's own pending unpaid booking request,
-- open cookie preferences). The user confirms on a card, the server re-checks
-- ownership and state, and the client then calls the existing endpoint with
-- the user's own session. Every step is recorded here, so this table is both
-- the one-shot proposal token and the audit log. No action can move money,
-- refund, or approve/adjust OxSteed Credit.

CREATE TABLE IF NOT EXISTS support_chat_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type   VARCHAR(40) NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CONSTRAINT support_chat_actions_status_check
    CHECK (status IN ('proposed', 'confirmed', 'succeeded', 'failed', 'dismissed', 'rejected')),
  page          VARCHAR(200),
  reject_reason VARCHAR(60),
  result_code   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes'
);

CREATE INDEX IF NOT EXISTS idx_support_chat_actions_user_created
  ON support_chat_actions (user_id, created_at DESC);
