-- 731: Connect Media posts to real city/category Spaces.
-- Posts remain public by default; the nullable relation preserves existing
-- launch posts while allowing Spaces to own their local timeline.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS community_id UUID
    REFERENCES media_communities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_posts_community
  ON media_posts(community_id, created_at DESC)
  WHERE community_id IS NOT NULL AND deleted_at IS NULL;
