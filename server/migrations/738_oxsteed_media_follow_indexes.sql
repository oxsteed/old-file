-- 738: support actor follower counts and Following-feed reads.
CREATE INDEX IF NOT EXISTS idx_media_follows_actor_created
  ON media_follows(actor_id, created_at DESC);
