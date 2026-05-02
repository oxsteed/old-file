-- Migration 154: Admin Impersonation, User Notes, Login History & Status Controls
--
-- Adds infrastructure for:
--   1. Login-as-user (impersonation) audit trail
--   2. Internal admin notes per user (never visible to user)
--   3. Login history per user (IP, user agent, timestamp)
--   4. Granular account status: suspended + restricted (complement existing is_banned)
--   5. Additional user profile fields: city, state, country, bio, warning_count, last_login_ip

-- ---------------------------------------------------------------------------
-- 1. Impersonation log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_impersonation_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti       VARCHAR(128) NOT NULL UNIQUE,   -- JWT jti claim for revocation
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,                    -- NULL = session still active
  ip_address      INET,
  user_agent      TEXT,
  notes           TEXT                            -- optional admin note
);

CREATE INDEX IF NOT EXISTS idx_impersonation_admin    ON user_impersonation_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_target   ON user_impersonation_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_started  ON user_impersonation_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_jti      ON user_impersonation_log(token_jti);

-- ---------------------------------------------------------------------------
-- 2. Admin notes (internal memos — never shown to the user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_user_notes (
  id              BIGSERIAL    PRIMARY KEY,
  target_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_text       TEXT         NOT NULL CHECK (char_length(note_text) BETWEEN 1 AND 4000),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_target  ON admin_user_notes(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_notes_admin   ON admin_user_notes(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_notes_created ON admin_user_notes(created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Login history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_login_history (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address      INET,
  user_agent      TEXT,
  country_code    CHAR(2),                        -- optional GeoIP later
  login_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  success         BOOLEAN      NOT NULL DEFAULT TRUE,
  failure_reason  VARCHAR(100)                    -- e.g. 'wrong_password', 'banned'
);

CREATE INDEX IF NOT EXISTS idx_login_history_user    ON user_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_at      ON user_login_history(login_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_ip      ON user_login_history(ip_address);

-- ---------------------------------------------------------------------------
-- 4. Granular status columns on users
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_suspended        BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_until     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason   TEXT,
  ADD COLUMN IF NOT EXISTS suspended_by        UUID         REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS is_restricted       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS restriction_reason  TEXT,
  ADD COLUMN IF NOT EXISTS restricted_by       UUID         REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS warning_count       INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_ip       INET,
  ADD COLUMN IF NOT EXISTS city                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state               VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country             VARCHAR(10)  DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS bio                 TEXT;

-- Auto-lift expired suspensions via index (app-level check uses suspended_until)
CREATE INDEX IF NOT EXISTS idx_users_suspended   ON users(suspended_until) WHERE is_suspended = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_restricted  ON users(is_restricted)   WHERE is_restricted = TRUE;
