-- Review P1-174: multi-crew Direct bookings persisted only crew[0] as
-- assigned_to, so the rest of the crew looked free and could be double-booked.
CREATE TABLE IF NOT EXISTS quote_request_crew (
  quote_request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quote_request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_quote_request_crew_user ON quote_request_crew (user_id);

-- Backfill: the lead assignee of every existing request is its crew.
INSERT INTO quote_request_crew (quote_request_id, user_id)
SELECT id, assigned_to FROM quote_requests WHERE assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;
