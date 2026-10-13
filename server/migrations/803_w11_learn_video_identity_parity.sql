BEGIN;

-- P1-346: historical URL identities must match the application normalizer.
-- Decode the encoded query key accepted by URLSearchParams, ignore fragments,
-- and accept redundant leading slashes on short links. Do not rewrite 793.
CREATE OR REPLACE FUNCTION learn_video_identity(raw_url TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  u TEXT := split_part(btrim(raw_url), '#', 1);
  candidate TEXT;
  encoded TEXT[];
  decoded INTEGER;
BEGIN
  IF u ~* '^https?://(?:[^/?#@]*@)?(?:www\.|m\.)?youtube\.com(?::[0-9]+)?/' THEN
    candidate := substring(substring(u FROM '\?(.*)$') FROM '(?:^|&)(?:v|%76)=([^&]*)');
    IF candidate IS NULL OR candidate = '' THEN
      candidate := substring(split_part(u, '?', 1) FROM '/(?:embed|shorts)/([^/?#]+)');
    END IF;
  ELSIF u ~* '^https?://(?:[^/?#@]*@)?youtu\.be(?::[0-9]+)?/' THEN
    candidate := substring(split_part(u, '?', 1) FROM '(?i)^https?://(?:[^/?#@]*@)?[^/]+/+([^/?#]+)');
  ELSIF u ~* '^https?://(?:[^/?#@]*@)?(?:www\.|player\.)?vimeo\.com(?::[0-9]+)?/' THEN
    candidate := substring(split_part(u, '?', 1) FROM '/([0-9]+)(?:[/?#]|$)');
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

-- Rebuild expression indexes because existing values used the old function.
REINDEX INDEX idx_lgvs_provider_identity;
REINDEX INDEX idx_lgv_provider_identity;

-- Reapply the existing blocked-decision backfill for previously missed aliases.
INSERT INTO learn_guide_video_moderation_blocks
  (guide_id, video_identity, video_url, reason, decided_by, created_at)
SELECT DISTINCT ON (guide_id, learn_video_identity(video_url))
  guide_id, learn_video_identity(video_url), video_url, 'blocked', decided_by,
  COALESCE(decided_at, created_at)
FROM learn_guide_video_submissions
WHERE status = 'blocked' AND learn_video_identity(video_url) IS NOT NULL
ORDER BY guide_id, learn_video_identity(video_url), created_at DESC
ON CONFLICT (guide_id, video_identity) DO NOTHING;

COMMIT;
