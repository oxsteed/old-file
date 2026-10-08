-- OxSteed Media share counts and idempotent share records.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS share_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS media_shares (
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  user_id UUID NULL,
  viewer_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, viewer_hash)
);

CREATE INDEX IF NOT EXISTS idx_media_shares_post ON media_shares(post_id, created_at DESC);
