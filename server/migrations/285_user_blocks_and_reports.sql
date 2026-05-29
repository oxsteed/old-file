-- Migration 285: user blocks and general content reports
-- Supports Apple App Store guideline 1.2 (UGC: block abusive users, report content)

-- ── User blocks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_blocks (
  id            SERIAL PRIMARY KEY,
  blocker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_blocks UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);

-- ── General content / user reports ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id              SERIAL PRIMARY KEY,
  reporter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content_type    VARCHAR(50) NOT NULL,   -- 'user', 'message', 'job', 'review', 'profile'
  content_id      VARCHAR(100),           -- ID of the reported item (nullable for user-level reports)
  reason          VARCHAR(50) NOT NULL,   -- 'spam', 'harassment', 'fraud', 'inappropriate', 'other'
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'reviewed', 'actioned', 'dismissed'
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_report CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported_user ON content_reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status);
