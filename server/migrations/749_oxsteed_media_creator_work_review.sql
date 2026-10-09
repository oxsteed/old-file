-- Preserve reserved Credit while delivered creator work is contested.
CREATE TABLE IF NOT EXISTS media_creator_work_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('gig','sponsorship')),
  reference_id UUID NOT NULL,
  requester_user_id UUID NOT NULL REFERENCES users(id),
  payer_user_id UUID NOT NULL REFERENCES users(id),
  creator_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 4000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','released','resumed')),
  decision_reason TEXT,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_creator_work_reviews_open
  ON media_creator_work_reviews(kind, reference_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_media_creator_work_reviews_queue
  ON media_creator_work_reviews(status, created_at);
ALTER TABLE media_creator_sponsorships ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE media_creator_applications ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE media_creator_gigs ADD COLUMN IF NOT EXISTS awarded_application_id UUID REFERENCES media_creator_applications(id);
