BEGIN;

CREATE TABLE IF NOT EXISTS background_checks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  checkr_candidate_id VARCHAR(255),
  checkr_invitation_id VARCHAR(255),
  checkr_report_id VARCHAR(255),
  status VARCHAR(30) DEFAULT 'pending',
  result VARCHAR(30) NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  adjudication VARCHAR(30) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_bg_status CHECK (status IN ('pending', 'invited', 'in_progress', 'complete', 'suspended', 'error')),
  CONSTRAINT chk_bg_result CHECK (result IN (NULL, 'clear', 'consider', 'adverse'))
);

CREATE INDEX IF NOT EXISTS idx_bg_checks_user ON background_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_bg_checks_status ON background_checks(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bg_checks_checkr ON background_checks(checkr_candidate_id);

-- Identity verification records (Stripe Identity)
CREATE TABLE IF NOT EXISTS identity_verifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  stripe_verification_session_id VARCHAR(255) UNIQUE,
  status VARCHAR(30) DEFAULT 'requires_input',
  type VARCHAR(20) DEFAULT 'document',
  verified_name VARCHAR(255) NULL,
  verified_dob DATE NULL,
  document_type VARCHAR(50) NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_iv_status CHECK (status IN ('requires_input', 'processing', 'verified', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_iv_user ON identity_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_iv_stripe ON identity_verifications(stripe_verification_session_id);

-- Badges table
CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  label VARCHAR(100) NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_badges_user ON badges(user_id);
CREATE INDEX IF NOT EXISTS idx_badges_type ON badges(type);

-- Seed badge types
INSERT INTO badges (user_id, type, label) VALUES (0, '_template', 'verified') ON CONFLICT DO NOTHING;
-- Badge types: verified, pro, top_helper, reliable, insured, background_clear

COMMIT;
