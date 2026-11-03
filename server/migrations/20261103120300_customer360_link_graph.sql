-- Customer 360 upgrade 5: weighted duplicate/fraud link graph and a guided
-- merge-review flow. Identity signals are stored only as keyed HMAC-SHA256
-- digests (never the device id, card fingerprint, bank fingerprint or
-- address itself). Reviews record a decision; nothing here merges accounts
-- or balances, and a duplicate finding needs two distinct administrators.

CREATE TABLE IF NOT EXISTS customer_identity_signals (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('device', 'card', 'bank', 'address')),
  value_hash     CHAR(64)    NOT NULL CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  source         VARCHAR(40) NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, value_hash)
);
CREATE INDEX IF NOT EXISTS customer_identity_signals_value_idx
  ON customer_identity_signals (kind, value_hash);

CREATE TABLE IF NOT EXISTS customer_link_reviews (
  id                 BIGSERIAL PRIMARY KEY,
  user_a             UUID         NOT NULL REFERENCES users(id),
  user_b             UUID         NOT NULL REFERENCES users(id),
  score              NUMERIC(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),
  signal_kinds       TEXT[]       NOT NULL DEFAULT '{}',
  status             VARCHAR(30)  NOT NULL DEFAULT 'in_review'
                       CHECK (status IN ('in_review', 'awaiting_second_review', 'confirmed_duplicate', 'confirmed_distinct', 'dismissed')),
  checklist          JSONB        NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checklist) = 'object'),
  opened_by          UUID         NOT NULL REFERENCES users(id),
  proposed_by        UUID REFERENCES users(id),
  proposed_at        TIMESTAMPTZ,
  decided_by         UUID REFERENCES users(id),
  decided_at         TIMESTAMPTZ,
  decision_reason    VARCHAR(500),
  revision           INTEGER      NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_link_reviews_ordered CHECK (user_a < user_b),
  -- Two distinct administrators for a duplicate finding.
  CONSTRAINT customer_link_reviews_two_admins CHECK (
    status <> 'confirmed_duplicate' OR (proposed_by IS NOT NULL AND decided_by IS NOT NULL AND proposed_by <> decided_by))
);
-- One active review per pair; closed reviews stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS customer_link_reviews_active_pair
  ON customer_link_reviews (user_a, user_b) WHERE status IN ('in_review', 'awaiting_second_review');
CREATE INDEX IF NOT EXISTS customer_link_reviews_queue_idx ON customer_link_reviews (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS customer_link_reviews_user_b_idx ON customer_link_reviews (user_b);
