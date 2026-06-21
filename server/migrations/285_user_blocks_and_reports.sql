-- Migration 285: user blocks and general content reports
-- Supports Apple App Store guideline 1.2 (UGC: block abusive users, report content)

-- ── User blocks ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'users'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS user_blocks (
      id            SERIAL PRIMARY KEY,
      blocker_id    %1$s NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id    %1$s NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_blocks UNIQUE (blocker_id, blocked_id),
      CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id)
    )
  $sql$, user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_id);

-- ── General content / user reports ──────────────────────────────────────────
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  IF to_regclass('public.content_reports') IS NULL THEN
    SELECT format_type(a.atttypid, a.atttypmod)
    INTO user_id_type
    FROM pg_attribute a
    WHERE a.attrelid = 'users'::regclass
      AND a.attname = 'id'
      AND NOT a.attisdropped;

    EXECUTE format($sql$
      CREATE TABLE content_reports (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id      %1$s REFERENCES users(id) ON DELETE SET NULL,
        reported_user_id %1$s REFERENCES users(id) ON DELETE SET NULL,
        content_type     VARCHAR(50) NOT NULL,
        content_id       VARCHAR(100),
        reason           VARCHAR(50) NOT NULL,
        description      TEXT,
        status           VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by      %1$s REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at      TIMESTAMPTZ,
        action_taken     TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT no_self_report CHECK (reporter_id <> reported_user_id)
      )
    $sql$, user_id_type);
  END IF;
END $$;

-- Migration 005 created content_reports with target_type/target_id instead of
-- content_type/content_id. CREATE TABLE IF NOT EXISTS does not reconcile an
-- existing table, so upgrade that legacy shape before creating new indexes.
ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS content_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS target_id UUID,
  ADD COLUMN IF NOT EXISTS action_taken TEXT;

-- Match the existing reporter_id type. Some long-lived OxSteed databases use
-- an integer user key while newer installations use UUID.
DO $$
DECLARE
  reporter_id_type TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'content_reports'::regclass
      AND attname = 'reported_user_id'
      AND NOT attisdropped
  ) THEN
    SELECT format_type(a.atttypid, a.atttypmod)
    INTO reporter_id_type
    FROM pg_attribute a
    WHERE a.attrelid = 'content_reports'::regclass
      AND a.attname = 'reporter_id'
      AND NOT a.attisdropped;

    EXECUTE format(
      'ALTER TABLE content_reports ADD COLUMN reported_user_id %s REFERENCES users(id) ON DELETE SET NULL',
      reporter_id_type
    );
  END IF;
END $$;

UPDATE content_reports
SET
  content_type = COALESCE(content_type, target_type),
  content_id = COALESCE(content_id, target_id::text)
WHERE content_type IS NULL
   OR content_id IS NULL;

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
