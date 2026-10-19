-- Durable Growth Center link analytics (replaces the browser-local counter on
-- the Promote page). One row per share action by the owner, or per landing
-- visit from a tracked link. No contact details, IP addresses or user agents
-- are stored; visitors are represented only by a hashed, device-local key.
CREATE TABLE IF NOT EXISTS promotion_link_events (
  id BIGSERIAL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('helper','business')),
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('share','visit')),
  source TEXT NOT NULL CHECK (source ~ '^[a-z0-9_-]{1,60}$'),
  medium TEXT CHECK (medium IS NULL OR medium ~ '^[a-z0-9_-]{1,60}$'),
  campaign TEXT CHECK (campaign IS NULL OR char_length(campaign) <= 80),
  content TEXT CHECK (content IS NULL OR content ~ '^[a-z0-9_-]{1,60}$'),
  actor_key TEXT,
  dedupe_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotion_link_events_owner_check CHECK (
    (owner_type = 'helper' AND owner_user_id IS NOT NULL AND business_id IS NULL)
    OR (owner_type = 'business' AND business_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS promotion_link_events_dedupe
  ON promotion_link_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotion_link_events_helper_time
  ON promotion_link_events(owner_user_id, occurred_at DESC) WHERE owner_type = 'helper';
CREATE INDEX IF NOT EXISTS promotion_link_events_business_time
  ON promotion_link_events(business_id, occurred_at DESC) WHERE owner_type = 'business';
