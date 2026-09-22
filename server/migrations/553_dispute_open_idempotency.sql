-- Make job dispute creation safe to retry after a lost response.
-- Existing disputes remain unchanged and requests without a key keep the
-- original behavior.
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_disputes_job_client_request_id
  ON disputes (job_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
