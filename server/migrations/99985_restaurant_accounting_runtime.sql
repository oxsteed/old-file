ALTER TABLE restaurant_accounting_integrations
  ADD COLUMN IF NOT EXISTS credentials_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credential_lease UUID,
  ADD COLUMN IF NOT EXISTS credential_lease_until TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS restaurant_accounting_oauth_states (
  state_hash TEXT PRIMARY KEY,
  integration_id BIGINT NOT NULL REFERENCES restaurant_accounting_integrations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '10 minutes',
  consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS restaurant_accounting_documents (
  id UUID PRIMARY KEY,
  export_id BIGINT NOT NULL REFERENCES restaurant_accounting_exports(id) ON DELETE CASCADE,
  document_date DATE NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','posted','requires_reconciliation','failed')),
  external_id TEXT,
  attempted_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  error_code TEXT,
  UNIQUE(export_id,document_date)
);
