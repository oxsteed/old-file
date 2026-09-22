-- 547_chat_quote_share_idempotency.sql
-- Keep quote creation and chat sharing retry-safe across network timeouts.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_quotes') THEN
    ALTER TABLE business_quotes ADD COLUMN IF NOT EXISTS client_request_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'helper_quotes') THEN
    ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS client_request_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_quote_shares') THEN
    ALTER TABLE chat_quote_shares ADD COLUMN IF NOT EXISTS client_request_id UUID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_quotes_client_request
  ON business_quotes(business_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_helper_quotes_client_request
  ON helper_quotes(helper_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_quote_shares_client_request
  ON chat_quote_shares(shared_by, client_request_id)
  WHERE shared_by IS NOT NULL AND client_request_id IS NOT NULL;
