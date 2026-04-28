-- Credential removal tracking for self-reported credentials
-- Supports removal of licenses, insurance with audit trail

CREATE TABLE helper_credential_removals (
  id SERIAL PRIMARY KEY,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type VARCHAR(50) NOT NULL CHECK (credential_type IN ('license', 'insurance')),
  removal_reason VARCHAR(255) NOT NULL CHECK (removal_reason IN (
    'unverified', 'expired', 'false_claim', 'user_report', 'other'
  )),
  notes TEXT,
  removed_by_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_helper_credential_removals_helper ON helper_credential_removals(helper_id);
CREATE INDEX idx_helper_credential_removals_type ON helper_credential_removals(credential_type);
CREATE INDEX idx_helper_credential_removals_removed_at ON helper_credential_removals(removed_at DESC);
