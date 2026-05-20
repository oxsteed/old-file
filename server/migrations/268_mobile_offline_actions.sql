-- Mobile offline sync queue

CREATE TABLE IF NOT EXISTS mobile_offline_actions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_action_id VARCHAR(120) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (user_id, client_action_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_offline_actions_user_status
  ON mobile_offline_actions(user_id, status, created_at DESC);
