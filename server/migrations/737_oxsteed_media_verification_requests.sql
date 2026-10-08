-- OxSteed Media verification requests for business and restaurant publishers.
-- Helper identity verification continues to be owned by the Didit workflow
-- and users.is_verified; this table records entity verification review only.

CREATE TABLE IF NOT EXISTS media_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('business', 'restaurant')),
  entity_id TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'needs_changes', 'approved', 'rejected', 'withdrawn')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_note TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_verification_requests_requester
  ON media_verification_requests(requester_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_verification_requests_status
  ON media_verification_requests(status, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_verification_requests_active_entity
  ON media_verification_requests(requester_user_id, entity_type, entity_id)
  WHERE status IN ('submitted', 'in_review');
