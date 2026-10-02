-- Migration 651: bind platform approvals to the policy version reviewed.
-- Existing approvals with no version are intentionally invalidated and must
-- be resubmitted after this migration is applied.

BEGIN;

ALTER TABLE mode_platform_approvals
  ADD COLUMN IF NOT EXISTS policy_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mode_platform_policy_revisions (
  id                 BIGSERIAL PRIMARY KEY,
  mode               VARCHAR(40) NOT NULL,
  policy_updated_at  TIMESTAMPTZ NOT NULL,
  requires_approval  BOOLEAN NOT NULL,
  auto_approve       BOOLEAN NOT NULL,
  gated_actions      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  application_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mode, policy_updated_at)
);

CREATE INDEX IF NOT EXISTS idx_mode_policy_revisions_mode_created
  ON mode_platform_policy_revisions (mode, created_at DESC);

COMMIT;
