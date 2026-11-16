-- Support handoff context for customer-owned progressive-access applications.
-- The reference is deliberately a relation, not copied applicant data: every
-- read still authorizes the support conversation first, then resolves this
-- request against the conversation's customer_id.

BEGIN;

ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS access_request_id BIGINT
  REFERENCES access_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_conversations_access_request
  ON support_conversations (access_request_id)
  WHERE access_request_id IS NOT NULL;

COMMIT;
