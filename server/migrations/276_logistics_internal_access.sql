CREATE TABLE IF NOT EXISTS logistics_internal_access_credentials (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  internal_name VARCHAR(80) NOT NULL,
  security_key_hash TEXT NOT NULL,
  operations_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  compliance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  last_verified_route VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_logistics_internal_access_name_unique
  ON logistics_internal_access_credentials (LOWER(internal_name));

CREATE INDEX IF NOT EXISTS idx_logistics_internal_access_user
  ON logistics_internal_access_credentials (user_id);

CREATE INDEX IF NOT EXISTS idx_logistics_internal_access_active
  ON logistics_internal_access_credentials (is_active);
