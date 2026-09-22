-- 545_chat_artifact_idempotency.sql
-- Make shareable chat artifacts safe to retry after a lost response.

ALTER TABLE chat_agreements
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_agreements_client_request
  ON chat_agreements(shared_by, client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE chat_proof_of_payments
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_pop_user_client_request
  ON chat_proof_of_payments(submitted_by, client_request_id)
  WHERE submitted_by IS NOT NULL AND client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_pop_guest_client_request
  ON chat_proof_of_payments(guest_session_id, client_request_id)
  WHERE submitted_by IS NULL AND client_request_id IS NOT NULL;
