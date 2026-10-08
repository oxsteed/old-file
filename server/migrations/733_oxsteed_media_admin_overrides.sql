-- 733: Auditable administrator approval for quarantined Media content.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS admin_override_by UUID NULL,
  ADD COLUMN IF NOT EXISTS admin_override_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS admin_override_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_media_posts_admin_override
  ON media_posts(admin_override_at DESC)
  WHERE admin_override_at IS NOT NULL;
