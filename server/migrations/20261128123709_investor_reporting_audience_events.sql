-- Slice 5h, item 739 (D-782): the audience-change history.
--
-- decide() upserts the audience row and changeGrant() flips the grant,
-- but neither left a record of what the audience was: a holder could not
-- see when their datasets or entities changed, or why. One row per
-- audience change, written in the same transaction as the change itself,
-- so an event can never exist for a change that did not commit.
-- The holder's access history (listAccessHistory) merges these events
-- with the request decisions and grant changes.
CREATE TABLE IF NOT EXISTS investor_reporting_audience_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id BIGINT NOT NULL REFERENCES access_grants(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('granted', 'changed', 'removed', 'suspended', 'reinstated')),
  datasets JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_ids BIGINT[] NOT NULL DEFAULT '{}',
  reason_code VARCHAR(80),
  decision_id BIGINT REFERENCES access_request_decisions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS investor_reporting_audience_events_user_idx
  ON investor_reporting_audience_events(user_id, created_at DESC, id DESC);
