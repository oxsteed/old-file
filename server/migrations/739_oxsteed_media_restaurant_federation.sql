-- 739: Federate restaurant Media rows into the OxSteed Media branch.
-- One source row produces one Media post so retries cannot duplicate content.

ALTER TABLE media_posts
  ADD COLUMN IF NOT EXISTS source_restaurant_media_id UUID NULL
    REFERENCES restaurant_media(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_posts_restaurant_source
  ON media_posts(source_restaurant_media_id)
  WHERE source_restaurant_media_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_posts_restaurant_source
  ON media_posts(source_restaurant_media_id)
  WHERE source_restaurant_media_id IS NOT NULL;
