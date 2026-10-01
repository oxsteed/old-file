-- Migration 631: Guide video playlists with community voting and flags
-- A guide can now hold several videos: the admin-curated video (stored on
-- learn_guides.video_url) stays pinned first, and community videos rank
-- beneath it by "most helpful" votes. Users may flag a video as unrelated
-- (or spam / broken / inappropriate); flags go to an admin review queue
-- where the video can be moved to the right guide or deleted.

-- Community videos (published from learn_guide_video_submissions)
CREATE TABLE IF NOT EXISTS learn_guide_videos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id        TEXT NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  video_url       TEXT NOT NULL,
  video_provider  TEXT,
  source          TEXT NOT NULL DEFAULT 'community'
                  CHECK (source IN ('admin', 'community')),
  submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lgv_guide
  ON learn_guide_videos (guide_id);

-- Same link cannot appear twice on one guide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgv_guide_url
  ON learn_guide_videos (guide_id, video_url);

-- "Most helpful" votes: one per user per video.
CREATE TABLE IF NOT EXISTS learn_guide_video_votes (
  video_id    UUID NOT NULL REFERENCES learn_guide_videos(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (video_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lgvv_video
  ON learn_guide_video_votes (video_id);

-- Flags for admin review: unrelated / spam / broken / inappropriate.
CREATE TABLE IF NOT EXISTS learn_guide_video_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    UUID NOT NULL REFERENCES learn_guide_videos(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL
              CHECK (reason IN ('unrelated', 'spam', 'broken', 'inappropriate')),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lgvf_status
  ON learn_guide_video_flags (status, created_at);
CREATE INDEX IF NOT EXISTS idx_lgvf_video
  ON learn_guide_video_flags (video_id);

-- One open flag per user per video.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgvf_video_user_open
  ON learn_guide_video_flags (video_id, user_id)
  WHERE status = 'open';

-- Playlists replace the single-video model: several videos may now be
-- pending per guide, but the same link still cannot be submitted twice.
DROP INDEX IF EXISTS uq_lgvs_guide_pending;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgvs_guide_url_pending
  ON learn_guide_video_submissions (guide_id, video_url)
  WHERE status = 'pending';
