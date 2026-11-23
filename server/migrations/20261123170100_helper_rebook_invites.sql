-- Group 4 rest, item 193: repeat customer follow-up.
-- One row per "book me again" invite a helper sends to a past customer.
-- The service allows one invite per helper/customer pair per 30 days and
-- only after a completed job between them. Additive and idempotent.
CREATE TABLE IF NOT EXISTS helper_rebook_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT CHECK (message IS NULL OR char_length(message) <= 500),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT helper_rebook_invites_not_self CHECK (helper_id <> customer_id)
);
CREATE INDEX IF NOT EXISTS idx_helper_rebook_invites_pair
  ON helper_rebook_invites (helper_id, customer_id, sent_at DESC);
