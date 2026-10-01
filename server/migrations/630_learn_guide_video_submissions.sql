-- Migration 630: Community video submissions for Learn guides
-- Lets signed-in users attach a YouTube/Vimeo video to an existing guide.
-- A submission goes live automatically 24 hours after creation unless an
-- admin blocks it first (Emile's decision, 2026-10-01). Admins may also
-- approve early. Only YouTube/Vimeo URLs are accepted; the client renders
-- them in a sandboxed iframe.

CREATE TABLE IF NOT EXISTS learn_guide_video_submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id        TEXT NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  video_url       TEXT NOT NULL,
  video_provider  TEXT,
  submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','live','blocked','superseded')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lgvs_guide
  ON learn_guide_video_submissions (guide_id);
CREATE INDEX IF NOT EXISTS idx_lgvs_status_created
  ON learn_guide_video_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_lgvs_submitter
  ON learn_guide_video_submissions (submitted_by);

-- One live-or-pending submission per guide keeps the queue unambiguous:
-- a new submission supersedes older pending ones for the same guide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgvs_guide_pending
  ON learn_guide_video_submissions (guide_id)
  WHERE status = 'pending';
