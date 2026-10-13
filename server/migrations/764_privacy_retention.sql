-- Payment layers: privacy (decision #12).
--   * financial records are kept, pseudonymized, for the legal period
--   * EU/UK edit history (job_revisions) kept 24 months
--   * private fields stripped from revision snapshots after 90 days

CREATE TABLE IF NOT EXISTS privacy_erasure_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'processing', 'completed', 'blocked')),
  blocked_reason VARCHAR(80),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_erasure_open
  ON privacy_erasure_requests (user_id) WHERE status IN ('requested', 'processing');

ALTER TABLE users ADD COLUMN IF NOT EXISTS pseudonymized_at TIMESTAMPTZ;
ALTER TABLE job_revisions ADD COLUMN IF NOT EXISTS private_stripped_at TIMESTAMPTZ;
