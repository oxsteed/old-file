-- Track when a member last viewed a Space so the Media shell can show unread activity.
ALTER TABLE media_community_members
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_media_community_members_last_seen
  ON media_community_members (user_id, last_seen_at DESC);
