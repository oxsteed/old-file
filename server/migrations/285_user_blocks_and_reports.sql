-- Migration 285: user blocks and general content reports
-- Supports Apple App Store guideline 1.2 (UGC: block abusive users, report content)

-- ── User blocks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_blocks (
  id            SERIAL PRIMARY KEY,
  blocker_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_blocks UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);

-- ── General content / user reports ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id              SERIAL PRIMARY KEY,
  reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content_type    VARCHAR(50) NOT NULL,   -- 'user', 'message', 'job', 'review', 'profile'
  content_id      VARCHAR(100),           -- ID of the reported item (nullable for user-level reports)
  reason          VARCHAR(50) NOT NULL,   -- 'spam', 'harassment', 'fraud', 'inappropriate', 'other'
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'reviewed', 'actioned', 'dismissed'
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_report CHECK (reporter_id <> reported_user_id)
);

-- Migration 005 created content_reports with target_type/target_id instead of
-- content_type/content_id. CREATE TABLE IF NOT EXISTS does not reconcile an
-- existing table, so upgrade that legacy shape before creating new indexes.
ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS content_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS target_id UUID,
  ADD COLUMN IF NOT EXISTS action_taken TEXT;

UPDATE content_reports
SET
  content_type = COALESCE(content_type, target_type),
  content_id = COALESCE(content_id, target_id::text),
  reported_user_id = COALESCE(
    reported_user_id,
    CASE WHEN target_type IN ('user', 'profile') THEN target_id ELSE NULL END
  )
WHERE content_type IS NULL
   OR content_id IS NULL
   OR reported_user_id IS NULL;

-- Legacy target columns only support UUID-backed content. New report types use
-- the text content_id column, while the API continues filling both when it can.
ALTER TABLE content_reports
  ALTER COLUMN target_type DROP NOT NULL,
  ALTER COLUMN target_id DROP NOT NULL,
  ALTER COLUMN content_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'content_reports'::regclass
      AND conname = 'no_self_report'
  ) THEN
    ALTER TABLE content_reports
      ADD CONSTRAINT no_self_report
      CHECK (reporter_id <> reported_user_id) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported_user ON content_reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status);
