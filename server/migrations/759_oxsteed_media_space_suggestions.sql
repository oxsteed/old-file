-- Moderated Space lifecycle. Existing seeded Spaces remain active; new Spaces
-- enter through a reviewable suggestion before becoming public destinations.
ALTER TABLE media_communities
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS rules TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'media_communities_status_check'
       AND conrelid = 'media_communities'::regclass
  ) THEN
    ALTER TABLE media_communities
      ADD CONSTRAINT media_communities_status_check
      CHECK (status IN ('active', 'paused', 'archived'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS media_community_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  geo_scope VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  approved_community_id UUID REFERENCES media_communities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT media_community_suggestions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS media_community_suggestions_status_created_idx
  ON media_community_suggestions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS media_community_suggestions_requester_idx
  ON media_community_suggestions (requested_by, created_at DESC);
