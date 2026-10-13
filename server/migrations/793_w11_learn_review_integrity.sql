BEGIN;

-- Provider identity for historical URL variants. Nonunique indexes preserve
-- historical rows; the application serializes canonical identity mutations.
CREATE OR REPLACE FUNCTION learn_video_identity(raw_url TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  u TEXT := btrim(raw_url);
  candidate TEXT;
  encoded TEXT[];
  decoded INTEGER;
BEGIN
  IF u ~* '^https?://(?:[^/?#@]*@)?(?:www\.|m\.)?youtube\.com(?::[0-9]+)?/' THEN
    candidate := substring(u FROM '[?&]v=([^&#]+)');
    IF candidate IS NULL THEN
      candidate := substring(u FROM '/(?:embed|shorts)/([^/?#]+)');
    END IF;
  ELSIF u ~* '^https?://(?:[^/?#@]*@)?youtu\.be(?::[0-9]+)?/' THEN
    candidate := substring(u FROM '(?i)^https?://(?:[^/?#@]*@)?[^/]+/([^/?#]+)');
  ELSIF u ~* '^https?://(?:[^/?#@]*@)?(?:www\.|player\.)?vimeo\.com(?::[0-9]+)?/' THEN
    candidate := substring(u FROM '/([0-9]+)(?:[/?#]|$)');
    IF candidate IS NULL THEN RETURN NULL; END IF;
    RETURN 'vimeo:' || candidate;
  ELSE
    RETURN NULL;
  END IF;
  IF candidate IS NULL THEN RETURN NULL; END IF;
  LOOP
    encoded := regexp_match(candidate, '%([0-9A-Fa-f]{2})');
    EXIT WHEN encoded IS NULL;
    decoded := get_byte(decode(encoded[1], 'hex'), 0);
    IF NOT ((decoded BETWEEN 48 AND 57) OR (decoded BETWEEN 65 AND 90)
      OR (decoded BETWEEN 97 AND 122) OR decoded IN (45,95)) THEN RETURN NULL; END IF;
    candidate := replace(candidate, '%' || encoded[1], chr(decoded));
  END LOOP;
  IF candidate !~ '^[A-Za-z0-9_-]{3,}$' THEN RETURN NULL; END IF;
  RETURN 'youtube:' || candidate;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_lgvs_provider_identity
  ON learn_guide_video_submissions (guide_id, learn_video_identity(video_url));
CREATE INDEX IF NOT EXISTS idx_lgv_provider_identity
  ON learn_guide_videos (guide_id, learn_video_identity(video_url));

CREATE TABLE IF NOT EXISTS learn_guide_video_moderation_blocks (
  guide_id TEXT NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  video_identity TEXT NOT NULL,
  video_url TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('blocked', 'flag_deleted')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guide_id, video_identity)
);

-- Existing blocked decisions remain effective across URL aliases.
INSERT INTO learn_guide_video_moderation_blocks
  (guide_id, video_identity, video_url, reason, decided_by, created_at)
SELECT DISTINCT ON (guide_id, learn_video_identity(video_url))
  guide_id, learn_video_identity(video_url), video_url, 'blocked', decided_by,
  COALESCE(decided_at, created_at)
FROM learn_guide_video_submissions
WHERE status = 'blocked' AND learn_video_identity(video_url) IS NOT NULL
ORDER BY guide_id, learn_video_identity(video_url), created_at DESC
ON CONFLICT (guide_id, video_identity) DO NOTHING;

CREATE TABLE IF NOT EXISTS learn_video_review_notice_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES learn_guide_video_submissions(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('submitted', 'overdue')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, recipient_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_learn_review_notice_pending
  ON learn_video_review_notice_jobs (next_attempt_at, created_at, id)
  WHERE delivered_at IS NULL;

COMMIT;
