-- WP-077: an investor grant is only useful with an approved reporting audience.
-- The audience is separate from users.role and is evaluated at request time.
BEGIN;

CREATE TABLE IF NOT EXISTS investor_reporting_audiences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id     BIGINT NOT NULL REFERENCES access_grants(id) ON DELETE CASCADE,
  audience_key VARCHAR(160) NOT NULL,
  datasets     TEXT[] NOT NULL DEFAULT ARRAY['overview']::text[],
  status       VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended', 'revoked', 'expired')),
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  CONSTRAINT investor_reporting_audiences_grant_unique UNIQUE (grant_id),
  CONSTRAINT investor_reporting_audiences_audience_key CHECK (length(btrim(audience_key)) BETWEEN 1 AND 160),
  CONSTRAINT investor_reporting_audiences_datasets_nonempty CHECK (cardinality(datasets) > 0)
);

CREATE INDEX IF NOT EXISTS investor_reporting_audiences_user_idx
  ON investor_reporting_audiences (user_id, status, expires_at);

COMMIT;
