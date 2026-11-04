-- Cost audit 2026-11-04 item 9: durable ledger of fresh Didit session
-- mints, so the per-user daily mint cap can be enforced across instances
-- and restarts. Only fresh mints insert a row; reusing a saved session
-- never touches this table, so the cap counts mints, not reuses. The
-- window is rolling (last 24 hours), which needs no timezone assumption
-- and cannot be reset by waiting for midnight.
CREATE TABLE IF NOT EXISTS didit_session_mints (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  minted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS didit_session_mints_user_day_idx ON didit_session_mints (user_id, minted_at);
