-- 548_chat_quote_response_idempotency.sql
-- Preserve the customer response request so a timed-out acceptance or change
-- request can be replayed without applying the quote transition twice.

BEGIN;

ALTER TABLE business_quotes
  ADD COLUMN IF NOT EXISTS response_client_request_id UUID,
  ADD COLUMN IF NOT EXISTS response_action VARCHAR(24);

ALTER TABLE helper_quotes
  ADD COLUMN IF NOT EXISTS response_client_request_id UUID,
  ADD COLUMN IF NOT EXISTS response_action VARCHAR(24);

CREATE INDEX IF NOT EXISTS idx_business_quotes_response_request
  ON business_quotes(response_client_request_id)
  WHERE response_client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_helper_quotes_response_request
  ON helper_quotes(response_client_request_id)
  WHERE response_client_request_id IS NOT NULL;

COMMIT;
