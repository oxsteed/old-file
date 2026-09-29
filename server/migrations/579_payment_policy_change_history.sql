-- 579_payment_policy_change_history.sql
-- Permanent, immutable change history for helper custom off-platform payment settings.
-- Every PUT /api/helper-settings/policies change records what changed
-- (receiving details, deposit, notice, terms, enable/disable) so helpers and
-- support can review the full history of how a helper receives payment.

CREATE TABLE IF NOT EXISTS helper_payment_policy_history (
  id BIGSERIAL PRIMARY KEY,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_helper_payment_policy_history_helper
  ON helper_payment_policy_history(helper_id, created_at DESC);

-- Prevent any UPDATE or DELETE on the history table — immutable record
CREATE RULE helper_payment_policy_history_no_update AS ON UPDATE TO helper_payment_policy_history
  DO INSTEAD NOTHING;
CREATE RULE helper_payment_policy_history_no_delete AS ON DELETE TO helper_payment_policy_history
  DO INSTEAD NOTHING;
