-- Audit fixes (2026-10-06): missing indexes flagged in the whole-repo review.

-- Admin Direct inbox: per-row presentRequest + metadata->>'flow' filter.
-- Expression index for the flow filter.
CREATE INDEX IF NOT EXISTS idx_quote_requests_flow
  ON quote_requests ((metadata->>'flow'))
  WHERE metadata->>'flow' IS NOT NULL;

-- Quote clientRequestId idempotency: metadata-only is not enough.
-- Scoped unique index on (user_id, client_request_id) where present.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_requests_client_req_id
  ON quote_requests (user_id, (metadata->>'clientRequestId'))
  WHERE metadata->>'clientRequestId' IS NOT NULL;
