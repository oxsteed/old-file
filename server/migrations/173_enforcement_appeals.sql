-- Migration 173: Enforcement Appeals System
-- Allows users to appeal enforcement restrictions

CREATE TABLE IF NOT EXISTS enforcement_appeals (
  id BIGSERIAL PRIMARY KEY,
  enforcement_id BIGINT NOT NULL REFERENCES enforcement_actions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Appeal content
  appeal_text TEXT NOT NULL,
  evidence JSONB DEFAULT '[]', -- array of {type, content/url, description}

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, under_review, approved, denied

  -- Admin review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_notes TEXT,

  -- Timestamps
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appeals_enforcement ON enforcement_appeals(enforcement_id);
CREATE INDEX IF NOT EXISTS idx_appeals_user ON enforcement_appeals(user_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON enforcement_appeals(status) WHERE status IN ('pending', 'under_review');
CREATE INDEX IF NOT EXISTS idx_appeals_submitted ON enforcement_appeals(submitted_at DESC);

COMMIT;
