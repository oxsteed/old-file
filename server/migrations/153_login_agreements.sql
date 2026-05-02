-- Migration 153: login_agreements table
-- Stores a legal record of each user's active ToS/Privacy agreement at every sign-in.
-- user_id, typed full name, timestamp, IP address, and user-agent are all captured.

CREATE TABLE IF NOT EXISTS login_agreements (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name   VARCHAR(255) NOT NULL,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  agreed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_agreements_user_id  ON login_agreements(user_id);
CREATE INDEX IF NOT EXISTS idx_login_agreements_agreed_at ON login_agreements(agreed_at);
